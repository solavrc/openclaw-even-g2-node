import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalPanel, ManualSetupPanel, SessionContextPanel } from "./phone-panels-view";

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

(globalThis as ReactActGlobal).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("ManualSetupPanel", () => {
  it("renders manual setup copy and submits the current draft", async () => {
    const onDraftChange = vi.fn();
    const onSubmit = vi.fn();
    await render(
      <ManualSetupPanel
        setupCodeDraft="wss://gateway.example/ws"
        onSetupCodeDraftChange={onDraftChange}
        onSubmit={onSubmit}
      />,
    );

    expect(document.querySelector('[aria-label="Gateway setup"]')?.textContent).toContain("Manual fallback");
    const input = document.querySelector("input") as HTMLInputElement;
    const button = document.querySelector("button") as HTMLButtonElement;
    expect(input.value).toBe("wss://gateway.example/ws");
    expect(button.disabled).toBe(false);

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "setup-code");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      button.click();
    });

    expect(onDraftChange).toHaveBeenCalledWith("setup-code");
    expect(onSubmit).toHaveBeenCalledWith();
  });

  it("disables connect when the draft is blank", async () => {
    await render(
      <ManualSetupPanel
        setupCodeDraft=" "
        onSetupCodeDraftChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect((document.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("SessionContextPanel", () => {
  it("renders session options and emits refresh and switch callbacks", async () => {
    const onRefresh = vi.fn();
    const onSwitch = vi.fn();
    await render(
      <SessionContextPanel
        connected
        sessionKey="agent:main:main"
        sessionSelectOptions={[
          { key: "agent:main:main" },
          { key: "agent:main:direct:notes" },
        ]}
        onRefreshSessions={onRefresh}
        onSwitchSession={onSwitch}
      />,
    );

    const select = document.querySelector("select") as HTMLSelectElement;
    expect(document.querySelector('[aria-label="Selected session"]')?.textContent).toContain("agent:main:main");

    await act(async () => {
      select.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "agent:main:direct:notes");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(onSwitch).toHaveBeenCalledWith("agent:main:direct:notes");
  });
});

describe("ApprovalPanel", () => {
  it("renders approval metadata and resolves decisions", async () => {
    const onResolve = vi.fn();
    await render(
      <ApprovalPanel
        approvalTitle="shell command"
        cwd="/tmp/project"
        onResolve={onResolve}
      />,
    );

    expect(document.body.textContent).toContain("Approval required");
    expect(document.body.textContent).toContain("shell command");
    expect(document.body.textContent).toContain("/tmp/project");

    const [approve, reject] = [...document.querySelectorAll("button")];
    await act(async () => {
      approve?.click();
      reject?.click();
    });

    expect(onResolve).toHaveBeenCalledWith("allow-once");
    expect(onResolve).toHaveBeenCalledWith("deny");
  });
});
