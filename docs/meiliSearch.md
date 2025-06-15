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
