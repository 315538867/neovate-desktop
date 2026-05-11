import { existsSync } from "node:fs";

import type { ProjectGroup, ProjectGroupMember } from "../../../shared/features/project/types";
import type { ProjectStore } from "./project-store";

export interface GroupMemberExpanded {
  projectId: string;
  role: ProjectGroupMember["role"];
  /** 项目根路径；项目已被从 ProjectStore 删除时为 null */
  path: string | null;
  /** 项目显示名 */
  name: string;
  /** 项目已不存在（被删/被移动） */
  missing: boolean;
}

export class GroupService {
  constructor(private projectStore: ProjectStore) {}

  getGroup(id: string): ProjectGroup | undefined {
    return this.projectStore.getGroup(id);
  }

  getGroups(): ProjectGroup[] {
    return this.projectStore.getGroups();
  }

  /**
   * Expand group members into runtime objects with paths and existence checks.
   * Members whose projects no longer exist are marked as `missing: true`.
   */
  expandMembers(group: ProjectGroup): GroupMemberExpanded[] {
    return group.members.map((m) => {
      const project = this.projectStore.get(m.projectId);
      if (!project) {
        return {
          projectId: m.projectId,
          role: m.role,
          path: null,
          name: m.projectId, // fallback to id as name
          missing: true,
        };
      }
      const pathMissing = !existsSync(project.path);
      return {
        projectId: m.projectId,
        role: m.role,
        path: pathMissing ? null : project.path,
        name: project.name,
        missing: pathMissing,
      };
    });
  }

  /**
   * Find all groups that contain the given project id.
   */
  findGroupsContainingProject(projectId: string): ProjectGroup[] {
    return this.getGroups().filter((g) => g.members.some((m) => m.projectId === projectId));
  }

  /**
   * Check if a project is in any group. Returns the list of group references.
   */
  getProjectGroupRefs(projectId: string): { groupId: string; groupName: string }[] {
    return this.projectStore.findGroupsByProject(projectId);
  }
}
