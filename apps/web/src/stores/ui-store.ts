import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "system" | "light" | "dark";
type UiState = {
  theme: Theme;
  navigationOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleNavigation: () => void;
  closeNavigation: () => void;
};
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      navigationOpen: false,
      setTheme: (theme) => set({ theme }),
      toggleNavigation: () =>
        set((state) => ({ navigationOpen: !state.navigationOpen })),
      closeNavigation: () => set({ navigationOpen: false }),
    }),
    { name: "ui-preferences", partialize: (state) => ({ theme: state.theme }) },
  ),
);
