/**
 * Projects store — v1.0 Project 实体的前端状态
 *
 * Sprint 1 CP5a：最小可用版本。Sidebar 的 Project 切换器（CP5b）和路由重构（CP5c）
 * 在后续 checkpoint 消费 currentProjectId。
 */

import { create } from 'zustand';
import type { Project } from '@openspace/shared';
import { listProjects } from '../lib/api';

interface ProjectsState {
  projects: Project[];
  loaded: boolean;
  /** 当前选中 Project（Sidebar 切换器消费；空时显示 Welcome 页） */
  currentProjectId: string | null;

  refresh: () => Promise<void>;
  upsert: (project: Project) => void;
  remove: (id: string) => void;
  setCurrent: (id: string | null) => void;
  /** 根据 name (slug) 查 */
  getByName: (name: string) => Project | undefined;
  getById: (id: string) => Project | undefined;
  current: () => Project | null;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loaded: false,
  currentProjectId: null,

  refresh: async () => {
    const projects = await listProjects();
    set((s) => ({
      projects,
      loaded: true,
      // 如果当前没选中 project 且列表不为空，默认选第一个
      currentProjectId:
        s.currentProjectId && projects.some((p) => p.id === s.currentProjectId)
          ? s.currentProjectId
          : (projects[0]?.id ?? null),
    }));
  },

  upsert: (project) =>
    set((s) => {
      const idx = s.projects.findIndex((p) => p.id === project.id);
      const next = [...s.projects];
      if (idx >= 0) next[idx] = project;
      else next.push(project);
      return {
        projects: next,
        // 第一次 upsert 时自动选中
        currentProjectId: s.currentProjectId ?? project.id,
      };
    }),

  remove: (id) =>
    set((s) => {
      const next = s.projects.filter((p) => p.id !== id);
      return {
        projects: next,
        currentProjectId:
          s.currentProjectId === id ? (next[0]?.id ?? null) : s.currentProjectId,
      };
    }),

  setCurrent: (id) => set({ currentProjectId: id }),

  getByName: (name) => get().projects.find((p) => p.name === name),
  getById: (id) => get().projects.find((p) => p.id === id),
  current: () => {
    const { currentProjectId, projects } = get();
    return currentProjectId ? (projects.find((p) => p.id === currentProjectId) ?? null) : null;
  },
}));
