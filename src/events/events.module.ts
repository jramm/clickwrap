import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/**
 * Legal event / audit log module (GET /admin/events). Provider-only wiring: all evidence sources
 * (AdminAuditRepo + the domain repositories + Clock) come from the global RepositoryModule, so this
 * module only declares the controller and the aggregating service.
 */
@Module({
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
