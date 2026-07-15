import { IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListSystemDiagnosticDataSourcesDto {
  @IsOptional()
  @IsIn(['issues', 'all'])
  filter: 'issues' | 'all' = 'issues';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
