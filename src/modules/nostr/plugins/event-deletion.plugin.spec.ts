import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { EventDeletionPlugin } from './event-deletion.plugin';

describe('EventDeletionPlugin', () => {
  let plugin: EventDeletionPlugin;
  let mockLogger: any;

  beforeEach(async () => {
    mockLogger = {
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventDeletionPlugin,
        {
          provide: getLoggerToken(EventDeletionPlugin.name),
          useValue: mockLogger,
        },
      ],
    }).compile();

    plugin = module.get<EventDeletionPlugin>(EventDeletionPlugin);
  });

  it('should be defined', () => {
    expect(plugin).toBeDefined();
  });

  it('should allow non-deletion events to pass through', () => {
    const event = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      kind: 1, // Not a deletion event
      tags: [],
      content: 'test content',
      created_at: Date.now(),
      sig: 'test-sig',
    };

    const result = plugin.beforeHandleEvent(event);
    expect(result).toEqual({ canHandle: true });
  });

  it('should reject deletion events without e tags', () => {
    const event = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      kind: 5, // Deletion event
      tags: [],
      content: 'deletion event',
      created_at: Date.now(),
      sig: 'test-sig',
    };

    const result = plugin.beforeHandleEvent(event);
    expect(result).toEqual({
      canHandle: false,
      message: 'deletion event must contain at least one valid "e" tag'
    });
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('should reject deletion events with invalid e tags', () => {
    const event = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      kind: 5,
      tags: [
        ['e', 'invalid-event-id'], // Too short
        ['e', ''], // Empty
        ['t', '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'], // Wrong tag type
      ],
      content: 'deletion event',
      created_at: Date.now(),
      sig: 'test-sig',
    };

    const result = plugin.beforeHandleEvent(event);
    expect(result).toEqual({
      canHandle: false,
      message: 'deletion event must contain at least one valid "e" tag'
    });
  });

  it('should accept deletion events with valid e tags', () => {
    const event = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      kind: 5,
      tags: [
        ['e', '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'],
        ['e', 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'],
        ['t', 'hashtag'], // Non-e tag should be ignored
      ],
      content: 'deletion event',
      created_at: Date.now(),
      sig: 'test-sig',
    };

    const result = plugin.beforeHandleEvent(event);
    expect(result).toEqual({ canHandle: true });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('will request deletion of 2 events'),
      expect.objectContaining({
        deletionEventId: 'test-id',
        authorPubkey: 'test-pubkey',
        eventIds: [
          '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'
        ],
      })
    );
  });

  it('should handle exceptions gracefully', () => {
    const event = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      kind: 5,
      tags: null, // This will cause an error
      content: 'deletion event',
      created_at: Date.now(),
      sig: 'test-sig',
    } as any;

    const result = plugin.beforeHandleEvent(event);
    expect(result).toEqual({
      canHandle: false,
      message: 'invalid deletion event format'
    });
    expect(mockLogger.error).toHaveBeenCalled();
  });
}); 