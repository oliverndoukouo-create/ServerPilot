import { DiscordAPIError, type Guild, type Role } from 'discord.js';
import type { SetupRole } from './types.js';

export type RoleCreationResult = {
  created: string[];
  reused: string[];
  differences: string[];
};

function permissionDifference(existing: Role, planned: SetupRole) {
  const current = existing.permissions.bitfield.toString();
  if (current === planned.permissionsValue) {
    return undefined;
  }
  return `${planned.name} already exists with different permissions; existing role was reused unchanged.`;
}

export async function createRoles(guild: Guild, plannedRoles: SetupRole[]): Promise<RoleCreationResult> {
  const roles = await guild.roles.fetch();
  const result: RoleCreationResult = { created: [], reused: [], differences: [] };

  for (const plannedRole of plannedRoles) {
    const existing = roles.find((role) => role.name.toLowerCase() === plannedRole.name.toLowerCase());
    if (existing) {
      result.reused.push(plannedRole.name);
      const difference = permissionDifference(existing, plannedRole);
      if (difference) {
        result.differences.push(difference);
      }
      continue;
    }

    try {
      const created = await guild.roles.create({
        name: plannedRole.name,
        color: plannedRole.color,
        permissions: BigInt(plannedRole.permissionsValue),
        reason: 'ServerPilot setup role plan',
      });
      roles.set(created.id, created);
      result.created.push(plannedRole.name);
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        throw new Error(`Could not create the ${plannedRole.name} role (Discord error ${error.code}).`);
      }
      throw error;
    }
  }

  return result;
}