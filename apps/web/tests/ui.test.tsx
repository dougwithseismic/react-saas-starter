import { Button, ConfirmAction } from "@repo/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useUiStore } from "../src/stores/ui-store";

describe("account action safety", () => {
  it("requires explicit confirmation and returns focus when cancelled", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    render(
      <ConfirmAction
        title="Delete account?"
        description="This permanently removes your account."
        onConfirm={confirm}
      >
        Delete account
      </ConfirmAction>,
    );
    const trigger = screen.getByRole("button", { name: "Delete account" });
    await user.click(trigger);
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("does not submit a form unless explicitly configured", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Button>Toggle</Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("UI preferences storage", () => {
  it("persists theme but does not restore an open mobile navigation", () => {
    useUiStore.getState().setTheme("dark");
    useUiStore.getState().toggleNavigation();
    const saved = JSON.parse(localStorage.getItem("ui-preferences") ?? "{}");
    expect(saved.state).toEqual({ theme: "dark" });
    useUiStore.getState().closeNavigation();
    useUiStore.getState().setTheme("system");
  });
});
