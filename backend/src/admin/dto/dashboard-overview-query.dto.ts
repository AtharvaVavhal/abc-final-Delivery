import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

/** The period lengths the Overview offers. A closed list keeps the query
 * bounded (at most 2 × 90 days of orders are read). */
export const OVERVIEW_DAYS = [7, 30, 90] as const;
export const DEFAULT_OVERVIEW_DAYS = 30;

export class DashboardOverviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(OVERVIEW_DAYS)
  days: number = DEFAULT_OVERVIEW_DAYS;
}
