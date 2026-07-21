import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class ReleaseMcpSessionsDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsBoolean()
  idleOnly?: boolean;
}
