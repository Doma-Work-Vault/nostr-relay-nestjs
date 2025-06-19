import { Injectable } from '@nestjs/common';
import {
  Event,
  EventUtils,
  Filter,
  getTimestampInSeconds,
  EventRepository as IEventRepository,
} from '@nostr-relay/common';
import { Kysely, sql } from 'kysely';
import { isNil } from 'lodash';
import { TEventIdWithScore } from '../../types/event';
import { isGenericTagName, toGenericTag } from '../../utils';
import { EventSearchRepository } from './event-search.repository';
import { KyselyDb } from './kysely-db';
import { Database, EventRow } from './types';
import { EventDeletionPlugin } from '../nostr/plugins/event-deletion.plugin';

@Injectable()
export class EventRepository extends IEventRepository {
  private readonly db: Kysely<Database>;

  constructor(
    kyselyDb: KyselyDb,
    private readonly eventSearchRepository: EventSearchRepository,
    private readonly eventDeletionPlugin: EventDeletionPlugin,
  ) {
    super();
    this.db = kyselyDb.getDb();
  }

  isSearchSupported(): boolean {
    return true;
  }

  async upsert(event: Event) {
    const author = EventUtils.getAuthor(event);
    const expiredAt = EventUtils.extractExpirationTimestamp(event);
    const dTagValue = EventUtils.extractDTagValue(event);
    const genericTags = this.extractGenericTagsFrom(event);
    try {
      const { numInsertedOrUpdatedRows } = await this.db
        .transaction()
        .execute(async (trx) => {
          const eventInsertResult = await trx
            .insertInto('events')
            .values({
              id: event.id,
              pubkey: event.pubkey,
              author,
              kind: event.kind,
              created_at: event.created_at,
              tags: JSON.stringify(event.tags),
              generic_tags: genericTags,
              content: event.content,
              sig: event.sig,
              expired_at: expiredAt,
              d_tag_value: dTagValue,
              create_date: 'NOW()',
            })
            .onConflict((oc) =>
              oc
                .columns(['author', 'kind', 'd_tag_value'])
                .where('d_tag_value', 'is not', null)
                .doUpdateSet({
                  id: (eb) => eb.ref('excluded.id'),
                  pubkey: (eb) => eb.ref('excluded.pubkey'),
                  created_at: (eb) => eb.ref('excluded.created_at'),
                  tags: (eb) => eb.ref('excluded.tags'),
                  content: (eb) => eb.ref('excluded.content'),
                  sig: (eb) => eb.ref('excluded.sig'),
                  expired_at: (eb) => eb.ref('excluded.expired_at'),
                  generic_tags: (eb) => eb.ref('excluded.generic_tags'),
                  create_date: (eb) => eb.ref('excluded.create_date'),
                })
                .where((eb) =>
                  eb.or([
                    eb('events.created_at', '<', (eb) =>
                      eb.ref('excluded.created_at'),
                    ),
                    eb.and([
                      eb('events.created_at', '=', (eb) =>
                        eb.ref('excluded.created_at'),
                      ),
                      eb('events.id', '>', (eb) => eb.ref('excluded.id')),
                    ]),
                  ]),
                ),
            )
            .executeTakeFirst();

          if (eventInsertResult.numInsertedOrUpdatedRows === BigInt(0)) {
            return eventInsertResult;
          }

          if (genericTags.length > 0) {
            await trx
              .deleteFrom('generic_tags')
              .where('event_id', '=', event.id)
              .execute();

            await trx
              .insertInto('generic_tags')
              .values(
                genericTags.map((tag) => ({
                  tag,
                  event_id: event.id,
                  kind: event.kind,
                  author,
                  created_at: event.created_at,
                })),
              )
              .executeTakeFirst();
          }

          return eventInsertResult;
        });

      if (numInsertedOrUpdatedRows === BigInt(0)) {
        return { isDuplicate: true };
      }

      // replaceable event
      if (dTagValue !== null) {
        await this.eventSearchRepository.deleteReplaceableEvents(
          author,
          event.kind,
          dTagValue,
        );
      }

      await this.eventSearchRepository.add(event, {
        author,
        genericTags,
        expiredAt,
        dTagValue,
      });

      // Handle deletion events (NIP-09)
      if (event.kind === 5) {
        await this.processDeletionEvent(event);
      }

      return { isDuplicate: false };
    } catch (error) {
      if (error.code === '23505') {
        // 23505 is unique_violation
        return { isDuplicate: true };
      }
      throw error;
    }
  }

  async find(filter: Filter): Promise<Event[]> {
    const limit = this.getLimitFrom(filter);
    if (limit === 0) return [];

    if (filter.search) {
      return this.eventSearchRepository.find(filter);
    }

    const genericTagsCollection = this.extractGenericTagsCollectionFrom(filter);
    if (!filter.ids?.length && genericTagsCollection.length) {
      // too complex query
      if (genericTagsCollection.length > 2) {
        return [];
      }

      return await this.createGenericTagsSelectQuery(
        filter,
        genericTagsCollection[0],
        genericTagsCollection[1],
      )
        .select([
          'e.id',
          'e.pubkey',
          'e.kind',
          'e.tags',
          'e.content',
          'e.sig',
          'e.created_at',
        ])
        .limit(limit)
        .execute();
    }

    return await this.createSelectQuery(filter)
      .select(['id', 'pubkey', 'kind', 'tags', 'content', 'sig', 'created_at'])
      .limit(limit)
      .execute();
  }

  async findTopIds(filter: Filter): Promise<TEventIdWithScore[]> {
    const limit = this.getLimitFrom(filter, 1000);
    if (limit === 0) return [];

    if (filter.search) {
      return this.eventSearchRepository.findTopIds(filter);
    }

    let partialEvents: Pick<EventRow, 'id' | 'created_at'>[] = [];

    const genericTagsCollection = this.extractGenericTagsCollectionFrom(filter);
    if (!filter.ids?.length && genericTagsCollection.length) {
      // too complex query
      if (genericTagsCollection.length > 2) {
        return [];
      }

      partialEvents = await this.createGenericTagsSelectQuery(
        filter,
        genericTagsCollection[0],
        genericTagsCollection[1],
      )
        .select(['e.id', 'e.created_at'])
        .limit(limit)
        .execute();
    } else {
      partialEvents = await this.createSelectQuery(filter)
        .select(['id', 'created_at'])
        .limit(limit)
        .execute();
    }

    // TODO: algorithm to calculate score
    return partialEvents.map((event) => ({
      id: event.id,
      score: event.created_at,
    }));
  }

  async deleteExpiredEvents() {
    const { numDeletedRows } = await this.db
      .deleteFrom('events')
      .where('expired_at', '<', getTimestampInSeconds())
      .executeTakeFirst();
    return Number(numDeletedRows);
  }

  /**
   * Delete events by their IDs, but only if they were created by the specified author.
   * This ensures that only the original author can delete their own events.
   */
  async deleteEventsByIds(eventIds: string[], authorPubkey: string): Promise<number> {
    if (eventIds.length === 0) {
      return 0;
    }

    const { numDeletedRows } = await this.db.transaction().execute(async (trx) => {
      // First, delete from search index
      for (const eventId of eventIds) {
        await this.eventSearchRepository.deleteByEventId(eventId);
      }

      // Then delete from database, but only if the author matches
      return await trx
        .deleteFrom('events')
        .where('id', 'in', eventIds)
        .where('pubkey', '=', authorPubkey)
        .executeTakeFirst();
    });

    return Number(numDeletedRows);
  }

  async destroy() {
    await this.db.destroy();
  }

  private createSelectQuery(filter: Filter) {
    let query = this.db.selectFrom('events');

    if (filter.ids?.length) {
      query = query.where('id', 'in', filter.ids);
    }

    if (filter.since) {
      query = query.where('created_at', '>=', filter.since);
    }

    if (filter.until) {
      query = query.where('created_at', '<=', filter.until);
    }

    if (filter.authors?.length) {
      query = query.where('author', 'in', filter.authors);
    }

    if (filter.kinds?.length) {
      query = query.where('kind', 'in', filter.kinds);
    }

    const genericTagsCollection = this.extractGenericTagsCollectionFrom(filter);
    if (genericTagsCollection.length) {
      genericTagsCollection.forEach((genericTags) => {
        query = query.where(
          'generic_tags',
          '&&',
          sql<string[]>`ARRAY[${sql.join(genericTags)}]`,
        );
      });
    }

    return query.orderBy('created_at desc');
  }

  private createGenericTagsSelectQuery(
    filter: Filter,
    firstGenericTagsFilter: string[],
    secondGenericTagsFilter?: string[],
  ) {
    let query = this.db
      .selectFrom('generic_tags as g')
      .distinctOn(['g.event_id', 'g.created_at'])
      .rightJoin('events as e', 'e.id', 'g.event_id');

    if (secondGenericTagsFilter?.length) {
      query = query.innerJoin('generic_tags as g2', (join) =>
        join
          .onRef('g2.event_id', '=', 'g.event_id')
          .on('g2.tag', 'in', secondGenericTagsFilter),
      );
    }

    query = query.where('g.tag', 'in', firstGenericTagsFilter);

    if (filter.since) {
      query = query.where('g.created_at', '>=', filter.since);
    }

    if (filter.until) {
      query = query.where('g.created_at', '<=', filter.until);
    }

    if (filter.authors?.length) {
      query = query.where('g.author', 'in', filter.authors);
    }

    if (filter.kinds?.length) {
      query = query.where('g.kind', 'in', filter.kinds);
    }

    return query.orderBy('g.created_at desc');
  }

  private getLimitFrom(filter: Filter, defaultLimit = 100) {
    return Math.min(isNil(filter.limit) ? defaultLimit : filter.limit, 1000);
  }

  private extractGenericTagsCollectionFrom(filter: Filter): string[][] {
    return Object.keys(filter)
      .filter((key) => key.startsWith('#') && filter[key].length > 0)
      .map((key) => {
        const tagName = key[1];
        return filter[key].map((v: string) => toGenericTag(tagName, v));
      })
      .sort((a, b) => a.length - b.length);
  }

  private extractGenericTagsFrom(event: Event): string[] {
    const genericTagSet = new Set<string>();
    event.tags.forEach(([tagName, tagValue]) => {
      if (isGenericTagName(tagName)) {
        genericTagSet.add(toGenericTag(tagName, tagValue));
      }
    });
    return [...genericTagSet];
  }

  /**
   * Process a deletion event (kind 5) by deleting the referenced events.
   */
  private async processDeletionEvent(deletionEvent: Event): Promise<void> {
    try {
      // Extract event IDs from 'e' tags
      const eventIdsToDelete = this.eventDeletionPlugin.extractEventIdsFromTags(deletionEvent.tags);
      
      if (eventIdsToDelete.length === 0) {
        console.warn(`Deletion event ${deletionEvent.id} contains no valid 'e' tags`);
        return;
      }

      // Delete the events, but only if they were created by the same author
      const deletedCount = await this.deleteEventsByIds(
        eventIdsToDelete,
        deletionEvent.pubkey
      );

      console.log(
        `Deletion event ${deletionEvent.id} processed: ${deletedCount}/${eventIdsToDelete.length} events deleted`
      );
    } catch (error) {
      console.error(
        `Error processing deletion event ${deletionEvent.id}: ${error.message}`,
        error
      );
    }
  }
}
