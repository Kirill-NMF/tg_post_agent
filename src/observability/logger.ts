export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type Logger = {
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
};

export const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {}
};

export const consoleLogger: Logger = {
  info(fields, message) {
    console.info(JSON.stringify({ level: "info", message, ...compactFields(fields) }));
  },
  warn(fields, message) {
    console.warn(JSON.stringify({ level: "warn", message, ...compactFields(fields) }));
  },
  error(fields, message) {
    console.error(JSON.stringify({ level: "error", message, ...compactFields(fields) }));
  }
};

export function redactJobPayload(payload: Record<string, unknown>): LogFields {
  return {
    payloadKeys: Object.keys(payload).sort().join(",")
  };
}

function compactFields(fields: LogFields): LogFields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
