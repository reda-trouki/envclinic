import { createInterface } from "node:readline/promises";

export interface Choice<T extends string> {
  value: T;
  label: string;
}

export interface Prompter {
  /** False when there is no terminal to ask on (CI, pipes). Commands must not prompt then. */
  interactive: boolean;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  select<T extends string>(message: string, choices: Choice<T>[], defaultValue: T): Promise<T>;
  input(message: string, defaultValue?: string): Promise<string>;
}

export interface IO {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Whether stdout can show colors. */
  color: boolean;
  env: Record<string, string | undefined>;
  prompter: Prompter;
}

/** A prompter for runs without a terminal: nothing can be asked. */
export const nonInteractivePrompter: Prompter = {
  interactive: false,
  confirm: async (_message, defaultValue = false) => defaultValue,
  select: async (_message, _choices, defaultValue) => defaultValue,
  input: async (_message, defaultValue = "") => defaultValue,
};

/** Questions go to stderr so stdout stays clean for piping. */
function createReadlinePrompter(): Prompter {
  const ask = async (question: string): Promise<string> => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  };

  return {
    interactive: true,
    async confirm(message, defaultValue = false) {
      const answer = (await ask(`${message} ${defaultValue ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
      if (answer === "") return defaultValue;
      return answer === "y" || answer === "yes";
    },
    async select(message, choices, defaultValue) {
      const lines = choices.map((choice, index) => `  ${index + 1}) ${choice.label}${choice.value === defaultValue ? " (default)" : ""}`);
      const answer = await ask(`${message}\n${lines.join("\n")}\n> `);
      const byNumber = choices[Number(answer) - 1];
      if (byNumber) return byNumber.value;
      const byValue = choices.find((choice) => choice.value === answer.toLowerCase());
      return byValue ? byValue.value : defaultValue;
    },
    async input(message, defaultValue = "") {
      const answer = await ask(`${message}${defaultValue ? ` (${defaultValue})` : ""}: `);
      return answer === "" ? defaultValue : answer;
    },
  };
}

const canPrompt = Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY) && !process.env.CI;

export const processIO: IO = {
  out: (text) => {
    process.stdout.write(text);
  },
  err: (text) => {
    process.stderr.write(text);
  },
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb",
  env: process.env,
  prompter: canPrompt ? createReadlinePrompter() : nonInteractivePrompter,
};
