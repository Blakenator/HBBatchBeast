type DefaultMessage = {
  defaultMessage: string;
  id?: string;
  idOverridden?: boolean;
};

export function createMessages<
  K extends string,
  T extends Record<K, DefaultMessage>,
>(messages: T): T {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]: [K, DefaultMessage]) => [
      key,
      {
        // TODO replace with key
        id: value.defaultMessage,
        idOverridden: !!value.id,
        ...value,
      },
    ]),
  ) as T;
}
