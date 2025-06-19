import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiResponse, ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { Pubkey } from '../../../common/decorators';
import { ErrorVo } from '../../../common/vos';
import { FindEventsDto, HandleEventDto, RequestEventsDto } from '../dtos';
import { EventEntity, FilterEntity } from '../entities';
import { EventIdSchema } from '../schemas';
import { NostrRelayService } from '../services/nostr-relay.service';
import { FindEventByIdVo, FindEventsVo, RequestEventsVo } from '../vos';
import { EventRepository } from '../../repositories/event.repository';
import { EventDeletionPlugin } from '../plugins/event-deletion.plugin';

@Controller('api/v1/events')
@ApiTags('events')
export class EventController {
  constructor(
    private readonly nostrRelayService: NostrRelayService,
    private readonly eventRepository: EventRepository,
    private readonly eventDeletionPlugin: EventDeletionPlugin,
  ) {}

  /**
   * Handle a new event.
   */
  @Post()
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid event',
    type: ErrorVo,
  })
  async handleEvent(@Body() handleEventDto: HandleEventDto): Promise<void> {
    let event: EventEntity;
    try {
      event = await this.nostrRelayService.validateEvent(handleEventDto);
    } catch (error) {
      throw new BadRequestException(error.message);
    }

    const { success, message = '' } =
      await this.nostrRelayService.handleEvent(event);
    if (!success) {
      throw new BadRequestException(message);
    }
  }

  /**
   * Find an event by its ID.
   */
  @Get(':id')
  @ApiResponse({ type: FindEventByIdVo })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Event not found',
    type: ErrorVo,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid event ID',
    type: ErrorVo,
  })
  async findEventById(
    @Param('id') id: string,
    @Pubkey() pubkey?: string,
  ): Promise<FindEventByIdVo> {
    const { success: validateSuccess } = await EventIdSchema.safeParseAsync(id);
    if (!validateSuccess) {
      throw new BadRequestException('Invalid event ID');
    }

    const [event] = await this.nostrRelayService
      .findEvents([{ ids: [id] }], pubkey)
      .catch(() => []);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return { data: event };
  }

  /**
   * Find events based on a filter. This endpoint only supports a single filter.
   * For multiple filters, use the POST /request endpoint.
   */
  @Get()
  @ApiResponse({ type: FindEventsVo })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid filters',
    type: ErrorVo,
  })
  async findEvents(
    @Query() findEventsDto: FindEventsDto,
    @Pubkey() pubkey?: string,
  ): Promise<FindEventsVo> {
    let filter: FilterEntity = {};
    try {
      filter = await this.nostrRelayService.validateFilter(
        this.preprocessFindEventsDto(findEventsDto),
      );
    } catch (error) {
      throw new BadRequestException(error.message);
    }

    const events = await this.nostrRelayService
      .findEvents([filter], pubkey)
      .catch(() => []);
    return { data: events };
  }

  /**
   * Request events based on filters. This endpoint supports multiple filters.
   */
  @Post('request')
  @ApiResponse({ type: RequestEventsVo })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid filters',
    type: ErrorVo,
  })
  async requestEvents(
    @Body() requestEventsDto: RequestEventsDto,
    @Pubkey() pubkey?: string,
  ): Promise<RequestEventsVo> {
    let filters: FilterEntity[] = [];
    if (requestEventsDto.filters) {
      try {
        filters = await this.nostrRelayService.validateFilters(
          requestEventsDto.filters,
        );
      } catch (error) {
        throw new BadRequestException(error.message);
      }
    }
    if (filters.length === 0) {
      filters.push({});
    }

    const events = await this.nostrRelayService
      .findEvents(filters, pubkey)
      .catch(() => []);
    return { data: events };
  }

  /**
   * Delete events using a NIP-09 deletion event (kind 5).
   */
  @Delete()
  @ApiOperation({
    summary: 'Delete events using NIP-09',
    description: 'Delete events by submitting a signed NIP-09 deletion event (kind 5). The event must be properly signed by the original author.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'],
      properties: {
        id: {
          type: 'string',
          description: 'Event ID (32-bytes hex)',
          example: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
        },
        pubkey: {
          type: 'string',
          description: 'Public key of the event creator (32-bytes hex)',
          example: '32-character-hex-string-public-key00'
        },
        created_at: {
          type: 'number',
          description: 'Unix timestamp in seconds',
          example: 1617848625
        },
        kind: {
          type: 'number',
          description: 'Must be 5 for deletion events (NIP-09)',
          example: 5
        },
        tags: {
          type: 'array',
          description: 'Array of tags. Must include "e" tags for events to delete',
          items: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          example: [
            ['e', '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'],
            ['e', '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100']
          ]
        },
        content: {
          type: 'string',
          description: 'Content of the event. Can be empty for deletion events.',
          example: ''
        },
        sig: {
          type: 'string',
          description: 'Event signature (64-bytes hex)',
          example: '64-bytes-hex-signature'
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Events deleted successfully',
    schema: {
      type: 'object',
      properties: {
        deletedCount: { 
          type: 'number',
          description: 'Number of events that were successfully deleted',
          example: 2
        },
        message: { 
          type: 'string',
          description: 'Status message describing the result of the operation',
          example: 'Successfully deleted 2 event(s)'
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid event format, signature verification failed, or invalid event IDs',
    type: ErrorVo,
  })
  async deleteEvents(@Body() event: HandleEventDto): Promise<{ deletedCount: number; message: string }> {
    try {
      // Validate the deletion event
      const validatedEvent = await this.nostrRelayService.validateEvent(event);
      
      // Ensure it's a deletion event
      if (validatedEvent.kind !== 5) {
        throw new BadRequestException('Event must be kind 5 (deletion event)');
      }

      // Extract event IDs to delete from 'e' tags
      const eventIdsToDelete = this.eventDeletionPlugin.extractEventIdsFromTags(validatedEvent.tags);
      
      if (eventIdsToDelete.length === 0) {
        throw new BadRequestException('Deletion event must contain at least one valid "e" tag');
      }

      // Delete the events
      const deletedCount = await this.eventRepository.deleteEventsByIds(
        eventIdsToDelete,
        validatedEvent.pubkey
      );

      const message = deletedCount > 0 
        ? `Successfully deleted ${deletedCount} event(s)`
        : 'No events were deleted. Events may not exist or you may not have permission to delete them.';

      return {
        deletedCount,
        message
      };
    } catch (error) {
      throw new BadRequestException(`Failed to process deletion event: ${error.message}`);
    }
  }

  private preprocessFindEventsDto(findEventsDto: FindEventsDto) {
    const filter: FilterEntity = {};
    Object.keys(findEventsDto)
      .filter(
        (key) =>
          [
            'ids',
            'authors',
            'kinds',
            'since',
            'until',
            'limit',
            'search',
          ].includes(key) || !!key.match(/^[a-zA-Z]$/),
      )
      .forEach((key) => {
        let value = findEventsDto[key];
        // skip empty arrays or strings
        if (value.length === 0) {
          return;
        }
        if (
          !['since', 'until', 'limit', 'search'].includes(key) &&
          !Array.isArray(value)
        ) {
          value = value.split(',');
        }
        if (['kinds', 'since', 'until', 'limit'].includes(key)) {
          value = Array.isArray(value)
            ? value.map((v) => parseInt(v))
            : parseInt(value);
        }
        filter[key.match(/^[a-zA-Z]$/) ? `#${key}` : key] = value;
      });

    return filter;
  }
}
