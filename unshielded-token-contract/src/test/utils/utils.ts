export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const toHexPadded = (str: string, len = 64): string =>
  Buffer.from(str, "ascii").toString("hex").padStart(len, "0");

// A user address is a 32-byte value wrapped in { bytes }.
export const userAddress = (label: string): { bytes: Uint8Array } => ({
  bytes: Uint8Array.from(Buffer.from(toHexPadded(label), "hex"))
});
