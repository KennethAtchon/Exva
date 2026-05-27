import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "exva-theme";

export type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  if (theme === "light") {
    document.documentElement.classList.add("light");
  } else {
    document.documentElement.classList.remove("light");
  }
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return stored === "light" ? "light" : "dark";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
