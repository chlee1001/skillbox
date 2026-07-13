// Alt-screen lifecycle. Ink has no alt-buffer by default, so we drive it manually.
// The teardown MUST run no matter how the process ends — normal exit, SIGINT/TERM/HUP,
// or a crash — or the user is left staring at the alt buffer with a hidden cursor.
// leave() is idempotent; the guaranteed-last cleanup is the `exit` handler.

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const SHOW_CURSOR = "\x1b[?25h";

let left = false;

function leave(): void {
  if (left) return;
  left = true;
  try {
    process.stdout.write(LEAVE_ALT + SHOW_CURSOR);
  } catch {
    /* stdout may be gone during teardown — nothing we can do */
  }
}

// Enter the alt screen and register every teardown path. Returns the idempotent leave().
export function enterAltScreen(): () => void {
  process.stdout.write(ENTER_ALT);

  // `exit` fires last, after Ink's own raw-mode restore — the safety net.
  process.once("exit", leave);

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      leave();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
  process.once("uncaughtException", (err) => {
    leave();
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
  process.once("unhandledRejection", (err) => {
    leave();
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });

  return leave;
}
