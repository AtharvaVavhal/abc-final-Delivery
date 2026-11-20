import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /platform/tenants/:id/maintenance — turns the storefront maintenance
 * page on or off for the tenant's primary store. */
export class SetMaintenanceDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  justification?: string;
}
