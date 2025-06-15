import {
  BeforeHandleEventPlugin,
  BeforeHandleEventResult,
  Event,
} from '@nostr-relay/common';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * Plugin to validate NIP-09 Event Deletion requests.
 * Ensures deletion events (kind 5) have proper format with 'e' tags.
 */
@Injectable()
export class EventDeletionPlugin implements BeforeHandleEventPlugin {
  constructor(
    @InjectPinoLogger(EventDeletionPlugin.name)
    private readonly logger: PinoLogger,
  ) {}

  beforeHandleEvent(event: Event): BeforeHandleEventResult {
    // Only process deletion events (kind 5)
    if (event.kind !== 5) {
      return { canHandle: true };
    }

    try {
      // Extract event IDs from 'e' tags
      const eventIdsToDelete = this.extractEventIdsFromTags(event.tags);
      
      if (eventIdsToDelete.length === 0) {
        this.logger.warn(`Deletion event ${event.id} contains no valid 'e' tags`);
        return {
          canHandle: false,
          message: 'deletion event must contain at least one valid "e" tag'
        };
      }

      this.logger.debug(
        `Deletion event ${event.id} will request deletion of ${eventIdsToDelete.length} events`,
        {
          deletionEventId: event.id,
          authorPubkey: event.pubkey,
          eventIds: eventIdsToDelete,
        }
      );

      return { canHandle: true };
    } catch (error) {
      this.logger.error(
        `Error validating deletion event ${event.id}: ${error.message}`,
        error
      );
      return {
        canHandle: false,
        message: 'invalid deletion event format'
      };
    }
  }

  /**
   * Extract event IDs from 'e' tags in the deletion event.
   */
  public extractEventIdsFromTags(tags: string[][]): string[] {
    return tags
      .filter(tag => tag[0] === 'e' && tag[1])
      .map(tag => tag[1])
      .filter(eventId => this.isValidEventId(eventId));
  }

  /**
   * Validate that the event ID is a 64-character hex string.
   */
  private isValidEventId(eventId: string): boolean {
    return /^[0-9a-f]{64}$/i.test(eventId);
  }
} 