import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/**
 * Legal event / audit log module (GET /admin/events). Provider-only wiring: the EventRepo (the
 * append-only Event table the core writes to) comes from the global RepositoryModule, so this module
 * only declares the controller and the thin, table-backed read service.
 */
@Module({
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
