/** The credential clients send: `Authorization: Bearer <playerId>.<token>` (24 hex + 64 hex). */
export const bearerOf = (playerId: string, token: string): string => `${playerId}.${token}`;

export function parseBearer(header: string | undefined): { playerId: string; token: string } | null {
  if (!header) return null;
  const match = /^Bearer ([a-f0-9]{24})\.([a-f0-9]{64})$/.exec(header);
  return match ? { playerId: match[1]!, token: match[2]! } : null;
}
