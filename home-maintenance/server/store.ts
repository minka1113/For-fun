// All data lives in one JSON file (data/home.json): a household's tasks and history are small.
// Writes go through a queue and land via rename, so a crash never leaves a half-written file.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Data } from "../shared/types.js";

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function newId(): string {
  return randomBytes(8).toString("hex");
}

function empty(): Data {
  return { tasks: [], log: [], settings: { homeName: "Our home", timeZone: "", calendarToken: newToken() } };
}

export class Store {
  private data: Data = empty();
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly file: string) {}

  static async open(file: string): Promise<Store> {
    const store = new Store(file);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      const saved = JSON.parse(await readFile(file, "utf8")) as Partial<Data>;
      const base = empty();
      store.data = {
        tasks: saved.tasks ?? [],
        log: saved.log ?? [],
        settings: { ...base.settings, ...saved.settings },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      await store.save();
    }
    return store;
  }

  get(): Data {
    return this.data;
  }

  /** Applies a change and persists it. The change runs synchronously, so concurrent requests can't interleave. */
  async update<T>(change: (data: Data) => T): Promise<T> {
    const result = change(this.data);
    await this.save();
    return result;
  }

  private save(): Promise<void> {
    const json = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      await writeFile(`${this.file}.tmp`, json);
      await rename(`${this.file}.tmp`, this.file);
    });
    return this.writing;
  }
}
