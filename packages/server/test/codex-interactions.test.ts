import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import test from 'node:test';
import { CodexAppServerAdapter } from '../src/agents/codex/codex-app-server-adapter.js';
import {
  listPendingInputs,
  resolveInput,
  validateInputResponse,
} from '../src/agents/input-manager.js';
import { listPendingApprovals } from '../src/agents/approval-manager.js';
import type { CLIEvent } from '../src/agents/types.js';

const fakeServer = `#!/usr/bin/env node
const fs = require('node:fs');
const rl = require('node:readline').createInterface({input:process.stdin});
const send = (x) => process.stdout.write(JSON.stringify(x)+'\\n');
const emit = (method, params={}) => send({method,params:{threadId:'thread',turnId:'turn',...params}});
const complete = () => { emit('turn/completed',{turn:{id:'turn',status:'completed'}}); };
rl.on('line',line=>{
 const m=JSON.parse(line); fs.appendFileSync(process.env.REQUEST_LOG,line+'\\n');
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'thread'}}});
 if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:'turn'}}});emit('turn/started',{turn:{id:'turn'}});
  const scenario=process.env.SCENARIO;
  if(scenario==='events'){
   emit('item/agentMessage/delta',{threadId:'foreign',itemId:'bad',delta:'BAD'});
   emit('item/agentMessage/delta',{turnId:'foreign-turn',itemId:'bad-turn',delta:'BAD'});
   emit('turn/completed',{turn:{id:'old-turn',status:'completed'}});
   emit('item/started',{item:{id:'comment',type:'agentMessage',phase:'commentary'}});
   emit('item/agentMessage/delta',{itemId:'comment',delta:'Working'});
   emit('item/completed',{item:{id:'comment',type:'agentMessage',phase:'commentary',text:'Working'}});
   for(const item of [
    {id:'file',type:'fileChange',changes:[{path:'a.ts'}],status:'completed'},
    {id:'mcp',type:'mcpToolCall',server:'docs',tool:'search',arguments:{q:'x'},status:'completed',result:{ok:true}},
    {id:'agent',type:'collabAgentToolCall',tool:'spawnAgent',status:'completed',receiverThreadIds:['child']},
    {id:'shell',type:'commandExecution',command:'blocked',status:'declined',exitCode:null}
   ]) {emit('item/started',{item});emit('item/completed',{item});emit('item/completed',{item});}
   emit('item/started',{item:{id:'final',type:'agentMessage',phase:'final_answer'}});
   emit('item/agentMessage/delta',{itemId:'final',delta:'Answer'});
   emit('item/completed',{item:{id:'final',type:'agentMessage',phase:'final_answer',text:'Answer'}});
   emit('item/agentMessage/delta',{itemId:'final',delta:'DUPLICATE'});
   complete();process.stdout.write('',()=>process.exit(0));
  }else if(scenario==='resolved'){
   send({id:'question',method:'item/tool/requestUserInput',params:{threadId:'thread',turnId:'turn',questions:[],isBlocking:false}});
   send({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn',command:'x'}});
   emit('serverRequest/resolved',{threadId:'foreign',requestId:'question'});
   emit('serverRequest/resolved',{requestId:'question'});emit('serverRequest/resolved',{requestId:'approval'});
   complete();process.stdout.write('',()=>process.exit(0));
  }else if(scenario==='legacy'){
   emit('item/agentMessage/delta',{itemId:'first',delta:'One'});
   emit('item/completed',{item:{id:'first',type:'agentMessage',text:'One'}});
   emit('item/agentMessage/delta',{itemId:'second',delta:'Two'});
   emit('item/completed',{item:{id:'second',type:'agentMessage',text:'Two'}});
   complete();process.stdout.write('',()=>process.exit(0));
  }else if(scenario==='mcp-url'){
   send({id:'question',method:'mcpServer/elicitation/request',params:{threadId:'thread',turnId:'turn',mode:'url',message:'Sign in',url:'https://example.com',elicitationId:'login'}});
  }else if(scenario==='mcp'){
   send({id:'question',method:'mcpServer/elicitation/request',params:{threadId:'thread',turnId:null,serverName:'test',mode:'form',message:'Choose settings',requestedSchema:{type:'object',properties:{count:{type:'integer',minimum:1}},required:['count']}}});
  }else{
   send({id:'question',method:'item/tool/requestUserInput',params:{threadId:'thread',turnId:'turn',isBlocking:scenario!=='nonblocking',questions:[{id:'choice',header:'Choice',question:'Choose',isOther:true,isSecret:false,options:[{label:'A',description:'First'}]}]}});
   if(scenario==='nonblocking')complete();
  }
 }
 if(m.id==='question' && !m.method){complete();process.stdout.write('',()=>process.exit(0));}
});
`;

async function runScenario(scenario: string, onEvent?: (event: CLIEvent) => void) {
  const root = mkdtempSync(join(tmpdir(), 'openspace-input-'));
  const log = join(root, 'requests.jsonl');
  writeFileSync(join(root, 'codex'), fakeServer, { mode: 0o755 });
  try {
    const result = await new CodexAppServerAdapter().runDirect(
      {
        prompt: 'test',
        workingDirectory: root,
        codexAppServerKey: root,
        envVars: {
          PATH: `${root}${delimiter}${process.env.PATH}`,
          REQUEST_LOG: log,
          SCENARIO: scenario,
        },
      },
      { onEvent },
    );
    return { result, root, log };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test(
  'streams commentary, replaces it with final text, isolates turns, and deduplicates tools',
  { timeout: 5000 },
  async () => {
    const { result, root } = await runScenario('events');
    try {
      const deltas = result.events.filter((event) => event.type === 'text.delta');
      assert.deepEqual(
        deltas.map((event) => ({ text: event.text, phase: event.phase })),
        [
          { text: 'Working', phase: 'commentary' },
          { text: 'Answer', phase: 'final_answer' },
        ],
      );
      const final = result.events.find((event) => event.type === 'text.completed');
      assert.equal(final?.text, 'Answer');
      assert.ok(result.events.indexOf(final!) > result.events.indexOf(deltas[1]!));
      assert.equal(result.fullText, 'Answer');
      assert.equal(result.exitCode, 0);
      assert.equal(result.events.filter((event) => event.type === 'text.completed').length, 1);
      assert.equal(result.events.filter((event) => event.type === 'session.completed').length, 1);
      assert.equal(result.events.filter((event) => event.type === 'tool.started').length, 4);
      const completed = result.events.filter((event) => event.type === 'tool.completed');
      assert.equal(completed.length, 4);
      assert.equal(completed.find((event) => event.call_id === 'shell')?.success, false);
      assert.equal(JSON.stringify(result.events).includes('BAD'), false);
      assert.equal(JSON.stringify(result.events).includes('DUPLICATE'), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

for (const scenario of ['questions', 'mcp']) {
  test(`round trips ${scenario} responses over JSON-RPC`, { timeout: 5000 }, async () => {
    const { result, root, log } = await runScenario(scenario, (event) => {
      if (event.type === 'input.required')
        resolveInput(
          event.request_id,
          scenario === 'mcp'
            ? { action: 'accept', content: { count: 2 } }
            : { action: 'accept', answers: { choice: ['Custom answer'] } },
        );
    });
    try {
      assert.equal(result.exitCode, 0);
      const reply = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .find((message) => message.id === 'question');
      assert.deepEqual(
        reply.result,
        scenario === 'mcp'
          ? { action: 'accept', content: { count: 2 }, _meta: null }
          : { answers: { choice: { answers: ['Custom answer'] } } },
      );
      assert.equal(listPendingInputs().length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test(
  'nonblocking questions remain answerable after turn completion',
  { timeout: 5000 },
  async () => {
    const { root, log } = await runScenario('nonblocking');
    try {
      const input = listPendingInputs()[0];
      assert.ok(input);
      assert.equal(input.blocking, false);
      assert.equal(resolveInput(input.id, { action: 'accept', answers: { choice: ['A'] } }), true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const messages = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(messages.find((message) => message.id === 'question')?.result, {
        answers: { choice: { answers: ['A'] } },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'server-resolved requests disappear without duplicate replies',
  { timeout: 5000 },
  async () => {
    const { root, log } = await runScenario('resolved');
    try {
      assert.equal(listPendingInputs().length, 0);
      assert.equal(listPendingApprovals().length, 0);
      const replies = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(
        replies.some((message) => message.id === 'question' || message.id === 'approval'),
        false,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('form validation enforces field types, bounds, and titled enum choices', () => {
  const request = {
    id: 'test',
    kind: 'mcp' as const,
    title: 'test',
    blocking: true,
    createdAt: 0,
    mode: 'form',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1 },
        choice: { type: 'string', oneOf: [{ const: 'a', title: 'A' }] },
      },
      required: ['count'],
    },
  };
  assert.throws(() => validateInputResponse(request, { action: 'accept', content: { count: 0 } }));
  assert.throws(() =>
    validateInputResponse(request, { action: 'accept', content: { count: 1, choice: 'bad' } }),
  );
  assert.doesNotThrow(() =>
    validateInputResponse(request, { action: 'accept', content: { count: 1, choice: 'a' } }),
  );
});

test(
  'legacy messages preserve streaming and aggregate distinct items',
  { timeout: 5000 },
  async () => {
    const { result, root } = await runScenario('legacy');
    try {
      assert.equal(result.fullText, 'One\n\nTwo');
      assert.deepEqual(
        result.events.filter((event) => event.type === 'text.delta').map((event) => event.item_id),
        ['first', 'second'],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

for (const action of ['accept', 'decline', 'cancel'] as const) {
  test(`MCP URL ${action} returns a protocol result`, { timeout: 5000 }, async () => {
    const { root, log } = await runScenario('mcp-url', (event) => {
      if (event.type === 'input.required') resolveInput(event.request_id, { action });
    });
    try {
      const reply = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .find((message) => message.id === 'question');
      assert.deepEqual(reply.result, { action, content: null, _meta: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
