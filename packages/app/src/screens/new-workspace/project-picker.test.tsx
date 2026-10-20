// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import { useNewWorkspaceProjectPicker } from "./project-picker";

function project(input: {
  viewKey: string;
  projectKey: string | null;
  projectId: string;
  projectName: string;
}): HostProjectListItem {
  return {
    ...input,
    projectKind: "git",
    iconWorkingDir: `/work/${input.projectId}`,
    hosts: [
      {
        serverId: "host",
        projectId: input.projectId,
        iconWorkingDir: `/work/${input.projectId}`,
        worktreeSupport: "supported",
      },
    ],
    workspaceKeys: [],
  };
}

describe("useNewWorkspaceProjectPicker", () => {
  it("preserves a manual choice when the routed project hydrates", () => {
    const routePlacement = project({
      viewKey: '["host","route-local"]',
      projectKey: null,
      projectId: "route-local",
      projectName: "Route project",
    });
    const hydratedRouteProject = project({
      viewKey: "remote:github.com/acme/route",
      projectKey: "remote:github.com/acme/route",
      projectId: "route-local",
      projectName: "Route project",
    });
    const manualProject = project({
      viewKey: "remote:github.com/acme/manual",
      projectKey: "remote:github.com/acme/manual",
      projectId: "manual-local",
      projectName: "Manual project",
    });
    const { result, rerender } = renderHook(
      ({ routeProject, projects }) =>
        useNewWorkspaceProjectPicker({
          selectedServerId: "host",
          projects,
          routeProject,
          routeProjectContextViewKey: routePlacement.viewKey,
          lastActiveProject: null,
          allowAllProjects: true,
        }),
      {
        initialProps: {
          routeProject: routePlacement,
          projects: [routePlacement, manualProject],
        },
      },
    );

    const manualOption = result.current.projectPickerOptions.find(
      (option) => option.label === manualProject.projectName,
    );
    expect(manualOption).toBeDefined();
    act(() => result.current.handleSelectProjectOption(manualOption!.id));
    expect(result.current.selectedProject).toEqual(manualProject);

    rerender({
      routeProject: hydratedRouteProject,
      projects: [hydratedRouteProject, manualProject],
    });

    expect(result.current.selectedProject).toEqual(manualProject);
  });

  it("keeps the focused checkout as the creation source until another project is chosen", () => {
    const checkoutProject = project({
      viewKey: "remote:github.com/acme/repo",
      projectKey: "remote:github.com/acme/repo",
      projectId: "repo",
      projectName: "Repository",
    });
    const otherProject = project({
      viewKey: "remote:github.com/acme/other",
      projectKey: "remote:github.com/acme/other",
      projectId: "other",
      projectName: "Other repository",
    });
    const projects = [checkoutProject, otherProject];
    const { result, rerender } = renderHook(
      ({ routeSourceDirectory }) =>
        useNewWorkspaceProjectPicker({
          selectedServerId: "host",
          projects,
          routeProject: checkoutProject,
          routeProjectContextViewKey: checkoutProject.viewKey,
          routeServerId: "host",
          routeSourceDirectory,
          lastActiveProject: null,
          allowAllProjects: true,
        }),
      { initialProps: { routeSourceDirectory: "/work/checkouts/feature-a/packages/app" } },
    );

    expect(result.current.selectedSourceDirectory).toBe("/work/checkouts/feature-a/packages/app");
    rerender({ routeSourceDirectory: "/work/checkouts/feature-b" });
    expect(result.current.selectedSourceDirectory).toBe("/work/checkouts/feature-b");

    act(() => result.current.handleSelectProjectOption(`project:${otherProject.viewKey}`));
    expect(result.current.selectedSourceDirectory).toBe("/work/other");
  });
});
