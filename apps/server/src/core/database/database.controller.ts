import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';
import { DatabaseService } from './database.service';
import {
  AttachDatabasePageDto,
  CreateDatabaseDto,
  CreateDatabaseFieldDto,
  CreateDatabaseRecordDto,
  CreateDatabaseViewDto,
  DatabaseEmbedUrlDto,
  DatabaseInfoDto,
  DetachDatabaseRecordDto,
  ListDatabaseRecordsDto,
  ReorderDatabaseRecordDto,
  UpdateDatabaseFieldDto,
  UpdateDatabaseRecordDto,
  UpdateDatabaseTitleDto,
} from './dto/database.dto';

@UseGuards(JwtAuthGuard)
@Controller('databases')
export class DatabaseController {
  constructor(private readonly databaseService: DatabaseService) {}

  @HttpCode(HttpStatus.OK)
  @Post('create')
  create(@Body() dto: CreateDatabaseDto, @AuthUser() user: User) {
    return this.databaseService.createDatabase(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  info(@Body() dto: DatabaseInfoDto, @AuthUser() user: User) {
    return this.databaseService.getDatabase(dto.databaseId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/create')
  createView(@Body() dto: CreateDatabaseViewDto, @AuthUser() user: User) {
    return this.databaseService.createView(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('title/update')
  updateTitle(@Body() dto: UpdateDatabaseTitleDto, @AuthUser() user: User) {
    return this.databaseService.updateTitle(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields/create')
  createField(@Body() dto: CreateDatabaseFieldDto, @AuthUser() user: User) {
    return this.databaseService.createField(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields/update')
  updateField(@Body() dto: UpdateDatabaseFieldDto, @AuthUser() user: User) {
    return this.databaseService.updateField(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/list')
  listRecords(@Body() dto: ListDatabaseRecordsDto, @AuthUser() user: User) {
    return this.databaseService.listRecords(dto.databaseId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/create')
  createRecord(@Body() dto: CreateDatabaseRecordDto, @AuthUser() user: User) {
    return this.databaseService.createRecord(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/update')
  updateRecord(@Body() dto: UpdateDatabaseRecordDto, @AuthUser() user: User) {
    return this.databaseService.updateRecord(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/attach-page')
  attachPage(@Body() dto: AttachDatabasePageDto, @AuthUser() user: User) {
    return this.databaseService.attachPage(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/detach')
  detachRecord(@Body() dto: DetachDatabaseRecordDto, @AuthUser() user: User) {
    return this.databaseService.detachRecord(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/reorder')
  reorderRecord(
    @Body() dto: ReorderDatabaseRecordDto,
    @AuthUser() user: User,
  ) {
    return this.databaseService.reorderRecord(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('embed-url')
  embedUrl(@Body() dto: DatabaseEmbedUrlDto, @AuthUser() user: User) {
    return this.databaseService.getEmbedUrl(dto.databaseId, dto.viewId, user);
  }
}
