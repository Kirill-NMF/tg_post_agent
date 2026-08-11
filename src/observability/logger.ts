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

export function redactJobPayload(payload: Record<string, unknown>): LogFields {
  return {
    payloadKeys: Object.keys(payload).sort().join(",")
  };
}
