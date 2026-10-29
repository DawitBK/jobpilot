'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Light or dark, remembered per browser. The page is themed before it paints by the script in the root layout. */
export function ThemeSwitcher() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  return (
    <button
      type="button"
      className="btn btn-ghost h-9 w-9 min-h-0 p-0"
      aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle('dark', next);
        try {
          localStorage.setItem('jp-theme', next ? 'dark' : 'light');
        } catch {
          // storage blocked: the choice lasts until the page is closed
        }
        setDark(next);
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}
