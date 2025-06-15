# MeiliSearch Implementation

## Overview
MeiliSearch is implemented in this project as a search engine for Nostr events, providing fast and efficient full-text search capabilities. The implementation supports NIP-50 (Search Capability) when properly configured.

## Configuration

MeiliSearch configuration is managed through environment variables:

```env
MEILI_SEARCH_HOST=          # MeiliSearch server host URL
MEILI_SEARCH_API_KEY=       # API key for authentication
MEILI_SEARCH_SYNC_EVENT_KINDS=0,1,30023  # Event kinds to index (default)
```

## Implementation Details

### Index Structure

The search engine uses a single index named 'events' with the following attributes:

- **Searchable Attributes**:
  - `content` - The main searchable content of events

- **Filterable Attributes**:
  - `id` - Event ID
  - `author` - Event author's public key
  - `createdAt` - Event creation timestamp
  - `kind` - Event kind
  - `genericTags` - Processed event tags
  - `delegator` - Delegator information
  - `expiredAt` - Expiration timestamp
  - `dTagValue` - D tag value

- **Sortable Attributes**:
  - `createdAt` - Allows sorting by creation time

### Event Synchronization

1. **Event Addition**
   - New events are added to the index via `EventSearchRepository.add()`
   - Only events with kinds specified in `MEILI_SEARCH_SYNC_EVENT_KINDS` are indexed
   - Additional fields like author, genericTags, expiredAt, and dTagValue are included

2. **Event Deletion**
   The system handles event deletion in three ways:

   a. **Single Event Deletion**
   - Method: `deleteByEventId(eventId)`
   - Removes a specific event from the search index by its ID
   - Used during NIP-09 deletion events

   b. **Replaceable Event Deletion**
   - Method: `deleteReplaceableEvents(author, kind, dTagValue)`
   - Removes events that are being replaced by a new version
   - Ensures proper handling of replaceable events

   c. **Bulk Event Deletion**
   - Handled through the NIP-09 deletion event process
   - Deletes multiple events specified in the 'e' tags
   - Only deletes events if the deletion request comes from the original author

### Replaceable Events Handling

The system provides special handling for replaceable events (as defined in NIP-01), which include:
- Events with kinds between 10000-20000
- Events with kinds between 30000-40000 (addressable replaceable events)
- Events with kind 0 or 3

1. **Index Structure**
   - The unique index `e_author_kind_d_tag_value_idx` ensures only one event exists per (author, kind, d_tag_value) combination
   - For addressable replaceable events (30000-40000), the d_tag value uniquely identifies the replaceable event
   - For regular replaceable events (10000-20000), an empty d_tag value is used

2. **Update Process**
   When a new replaceable event is received:
   - The system extracts the d_tag value from the event
   - The `EventRepository.upsert` method handles the replacement logic
   - Before inserting the new event, existing events with the same (author, kind, d_tag_value) are deleted from the search index
   - The new event is then added to both the database and search index
   - The unique database constraint ensures atomic updates

3. **Search Index Consistency**
   - The `deleteReplaceableEvents` method in `EventSearchRepository` ensures old versions are removed from the search index
   - This maintains consistency between the database and search index for replaceable events
   - The deletion is performed using a filter on author, kind, and dTagValue fields

4. **Example Flow**
   For a kind 31000 event update:
   ```
   a. New event received with:
      - kind: 31000
      - author: pubkey123
      - d_tag: "my-identifier"
   
   b. System process:
      1. Extracts d_tag value "my-identifier"
      2. Calls deleteReplaceableEvents(pubkey123, 31000, "my-identifier")
      3. Removes old version from search index
      4. Inserts new event in database (replacing old version due to unique constraint)
      5. Adds new event to search index
   ```

### Search Implementation

1. **Basic Search**
   - Method: `find(filter: Filter)`
   - Supports full-text search with filtering and sorting
   - Results are ordered by creation time (descending)

2. **Top IDs Search**
   - Method: `findTopIds(filter: Filter)`
   - Returns event IDs with relevance scores
   - Score calculation: `createdAt * (1 + rankingScore)`

### Deletion and Index Consistency

The current implementation ensures index consistency by:
1. Deleting events from MeiliSearch index before removing from the database
2. Handling errors and logging them appropriately
3. Ensuring author verification before deletion
4. Supporting both single and bulk deletions

However, there are some considerations:

1. **Transaction Atomicity**: While the database operations are transactional, the MeiliSearch index updates are not part of the same transaction. This could potentially lead to inconsistencies if a failure occurs between updating MeiliSearch and the database.

2. **Error Recovery**: If an error occurs during MeiliSearch deletion, the error is logged but the operation continues. This could lead to index inconsistencies.

## Recommendations for Improvement

1. **Index Resyncing Tool**
   - Implement a tool to resync the MeiliSearch index with the database
   - This would help recover from any inconsistencies that might occur

2. **Batch Operations**
   - Implement batch processing for bulk operations
   - This would improve performance for large-scale deletions or updates

3. **Health Checks**
   - Add periodic health checks to verify index consistency
   - Implement automatic recovery procedures

4. **Error Handling**
   - Enhance error handling to include retry mechanisms
   - Consider implementing a queue system for failed operations

5. **Monitoring**
   - Add metrics for index operations
   - Monitor index size and performance
   - Track synchronization status

## Conclusion

The MeiliSearch implementation provides robust search capabilities for the Nostr relay. The delete endpoint does properly remove indexes of deleted events, but there could be edge cases where inconsistencies might occur due to the non-atomic nature of operations across two different systems (database and search index). The recommended improvements would help make the system more resilient and maintainable.
