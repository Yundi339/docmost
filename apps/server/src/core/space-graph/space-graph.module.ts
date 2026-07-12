import { Module } from '@nestjs/common';
import { SpaceGraphController } from './space-graph.controller';
import { SpaceGraphRepo } from './space-graph.repo';
import { SpaceGraphService } from './space-graph.service';

@Module({
  controllers: [SpaceGraphController],
  providers: [SpaceGraphRepo, SpaceGraphService],
})
export class SpaceGraphModule {}
