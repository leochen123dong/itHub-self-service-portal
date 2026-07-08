// UserAccessFlags bitmask helpers.
//
// ITHub user objects expose `UserAccessFlags: number` controlling which API
// methods the user can invoke. The full bit semantics aren't publicly
// documented (we only have observed aggregate value 0x7FFFFFFF = "allow all"
// from real /Security/Users/138 reads), so we expose:
//   - isAllowAll():      the one boolean we know the meaning of
//   - describeFlags():   human-readable breakdown for the UI ("Bit 0", etc.)
//     so admins can see the raw value without losing information.

export const ALLOW_ALL_FLAG = 0x7fffffff;

export function isAllowAll(flags: number): boolean {
  return flags === ALLOW_ALL_FLAG;
}

export function describeFlags(flags: number): string[] {
  if (!Number.isFinite(flags)) return [];
  if (isAllowAll(flags)) return ['允许全部 API 方法'];
  const bits: string[] = [];
  for (let i = 0; i < 31; i++) {
    if (flags & (1 << i)) bits.push(`Bit ${i}`);
  }
  return bits;
}

// 32-bit signed int — ITHub returns flags as a JSON number which JS
// represents safely up to 2^53, so no overflow risk.
export function toSignedFlags(flags: number): number {
  return flags | 0;
}