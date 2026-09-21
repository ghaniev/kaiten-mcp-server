import { z } from 'zod';

// ============================================
// COMMON SCHEMAS
// ============================================

export const IdempotencyKeySchema = z.string().optional().describe(
  'Unique idempotency key to prevent duplicate operations. Use the same key for retries. Format: client-generated UUID or timestamp-based string.'
);

export const VerbosityEnum = z.enum(['minimal', 'normal', 'detailed'])
  .optional()
  .default('normal')
  .describe(
    'Response detail level: ' +
    'minimal (id + title only, for quick lists), ' +
    'normal (default; for card lists this is the compact projection), ' +
    'detailed (kept for users and boards; for card lists it behaves like normal — ' +
    'ask a per-card tool with verbose: true when a rare field is needed)'
  );

export const VerboseFlag = z.boolean().optional().default(false).describe(
  'Return the full Kaiten object instead of the compact projection. Avatars are stripped in both modes. ' +
  'A full card is 8-77 KB, a projected one is under 1 KB — leave this off unless a rare field is really needed.'
);

export const CardIdsSchema = z
  .array(z.number().positive().int())
  .min(1)
  .max(100)
  // A repeated id means two concurrent PATCHes on one card, and in a reorder it
  // hands the same position to two entries.
  .refine((ids) => new Set(ids).size === ids.length, { message: 'card_ids must not contain duplicates' })
  .describe('Card IDs to act on, 1-100 per call, no duplicates');

export const ResponseFormatEnum = z.enum(['json', 'markdown'])
  .optional()
  .default('markdown')
  .describe(
    'Response format: ' +
    'json (structured data for programmatic use), ' +
    'markdown (human-readable formatted text, default)'
  );

// ============================================
// CARD SCHEMAS
// ============================================

export const GetCardSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the card to retrieve'),
  format: ResponseFormatEnum,
  verbose: VerboseFlag,
}).strict();

const AttachmentFileIdSchema = z.union([
  z.number().positive().int(),
  z.string().min(1),
]);

export const ListCardAttachmentsSchema = z.object({
  card_id: z.number().positive().int().describe('The card ID'),
  images_only: z.boolean().optional().default(false)
    .describe('Return only supported image attachments'),
}).strict();

export const GetCardImagesSchema = z.object({
  card_id: z.number().positive().int().describe('The card ID'),
  file_ids: z.array(AttachmentFileIdSchema).max(10).optional()
    .describe('Optional attachment IDs; omit to return the first images'),
  limit: z.number().positive().int().max(10).optional()
    .describe('Maximum number of images to return'),
}).strict();

export const GetTaskContextSchema = z.object({
  card_id: z.number().positive().int().describe('The task card ID'),
  include_images: z.boolean().optional().default(true)
    .describe('Include supported screenshot attachments'),
  image_limit: z.number().positive().int().max(10).optional()
    .describe('Maximum number of screenshots to return'),
}).strict();

export const CreateCardSchema = z.object({
  title: z.string().min(1).max(500).describe('The title of the card'),
  board_id: z.number().positive().int().describe('The ID of the board where the card will be created'),
  column_id: z.number().positive().int().optional().describe('The ID of the column (optional)'),
  lane_id: z.number().positive().int().optional().describe('The ID of the lane (optional)'),
  description: z.string().optional().describe('The description of the card (optional)'),
  type_id: z.number().positive().int().optional().describe('The type ID of the card (optional)'),
  size: z
    .number()
    .min(0)
    .optional()
    .describe('IGNORED BY KAITEN — the API answers 200 and stores nothing. Use size_text.'),
  size_text: z
    .string()
    .optional()
    .describe('The estimate, and the only one Kaiten stores. Format "<number> <unit>", e.g. "8 ч" or "3 д"; it backfills size and size_unit.'),
  asap: z.boolean().optional().describe('Mark as ASAP (optional)'),
  owner_id: z.number().positive().int().optional().describe('Card owner = who set the task (optional). NOT the assignee — see responsible_id.'),
  responsible_id: z
    .number()
    .positive()
    .int()
    .optional()
    .describe('Assignee: added as a card member with type 2 right after the card is created. This is what workload reports count.'),
  member_ids: z
    .array(z.number().positive().int())
    .max(20)
    .optional()
    .describe('Ordinary participants (type 1) to add after creation'),
  due_date: z.string().optional().describe('Due date in ISO format (optional)'),
  idempotency_key: IdempotencyKeySchema,
  verbose: VerboseFlag,
}).strict();

export const UpdateCardSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the card to update'),
  title: z.string().min(1).max(500).optional().describe('The new title (optional)'),
  description: z.string().optional().describe('The new description (optional)'),
  state: z
    .number()
    .optional()
    .describe(
      'New state: 1=queued, 2=in progress, 3=done. Kaiten derives state from the column type, so send it together with a column_id of that type — state 3 on a queue column is accepted and silently ignored.'
    ),
  board_id: z
    .number()
    .positive()
    .int()
    .optional()
    .describe(
      'Move the card to this board (optional). Columns and lanes belong to a board, so when you move a card across boards you must pass a column_id (and lane_id, if the board has several) from the TARGET board — ids from the old board are rejected.'
    ),
  column_id: z.number().positive().int().optional().describe('Move to this column ID (optional)'),
  lane_id: z.number().positive().int().optional().describe('Move to this lane ID (optional)'),
  type_id: z.number().positive().int().optional().describe('The new type ID (optional)'),
  size: z
    .number()
    .min(0)
    .optional()
    .describe('IGNORED BY KAITEN — the API answers 200 and stores nothing. Use size_text.'),
  size_text: z
    .string()
    .optional()
    .describe('The estimate, and the only one Kaiten stores. Format "<number> <unit>", e.g. "8 ч"; the tool reads the value back and reports if it did not stick.'),
  sort_order: z
    .number()
    .optional()
    .describe('Raw position inside the column (ascending). Prefer kaiten_set_card_order, which computes this from neighbours.'),
  asap: z.boolean().optional().describe('Mark as ASAP (optional)'),
  owner_id: z
    .number()
    .positive()
    .int()
    .optional()
    .describe(
      'The new owner ID (optional). A card cannot be left without an owner: the API rejects null with "Card.owner_id should be integer", so reassign instead of unassigning.'
    ),
  due_date: z
    .string()
    .nullable()
    .optional()
    .describe('New due date in ISO format, or null to clear it (the API accepts null here, unlike owner_id)'),
  idempotency_key: IdempotencyKeySchema,
  verbose: VerboseFlag,
})
  .strict()
  // Kaiten answers 400 to board_id without a column: columns belong to a board,
  // so the old one is not valid on the new board. Catch it before the round trip.
  .refine((v) => v.board_id === undefined || v.column_id !== undefined, {
    message: 'column_id is required when board_id is given — pass a column from the target board (kaiten_list_columns)',
    path: ['column_id'],
  });

export const AddCardChildSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the PARENT card'),
  child_id: z.number().positive().int().describe('The ID of the card that becomes a subtask'),
}).strict();

export const RemoveCardChildSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the PARENT card'),
  child_id: z.number().positive().int().describe('The ID of the subtask to detach'),
}).strict();

export const ListCardChildrenSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the parent card'),
}).strict();

export const DeleteCardSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the card to delete'),
}).strict();

export const SearchCardsSchema = z.object({
  // Text search
  query: z.string().optional().describe('Search query for partial case-insensitive matching'),

  // Basic filters
  space_id: z.number().optional().describe('Filter by space ID. Omit for default space, 0 for all spaces'),
  board_id: z.number().positive().int().optional().describe('Filter by board ID (RECOMMENDED to avoid large responses)'),
  column_id: z.number().positive().int().optional().describe('Filter by column ID (optional)'),
  lane_id: z.number().positive().int().optional().describe('Filter by lane ID (optional)'),
  title: z.string().optional().describe('Filter by title (optional)'),
  state: z.number().optional().describe('Filter by state: 1=queued, 2=inProgress, 3=done (optional)'),
  owner_id: z.number().positive().int().optional().describe('Filter by owner ID (optional)'),
  type_id: z.number().positive().int().optional().describe('Filter by card type ID (optional)'),
  condition: z.number().min(1).max(2).optional().describe('Filter by condition: 1=active (default), 2=archived'),

  // Date filters (ISO 8601 format)
  created_before: z.string().optional().describe('Created before date (ISO 8601 format, e.g., "2025-10-11T23:59:59Z")'),
  created_after: z.string().optional().describe('Created after date (ISO 8601 format, e.g., "2025-10-01T00:00:00Z")'),
  updated_before: z.string().optional().describe('Updated before date (ISO 8601 format)'),
  updated_after: z.string().optional().describe('Updated after date (ISO 8601 format)'),
  due_date_before: z.string().optional().describe('Due date before (ISO 8601 format)'),
  due_date_after: z.string().optional().describe('Due date after (ISO 8601 format)'),
  last_moved_to_done_at_before: z.string().optional().describe('Last moved to done before date (ISO 8601 format)'),
  last_moved_to_done_at_after: z.string().optional().describe('Last moved to done after date (ISO 8601 format)'),

  // Boolean flags
  asap: z.boolean().optional().describe('Filter by ASAP marker (true=only ASAP cards)'),
  archived: z.boolean().optional().describe('Filter by archived flag'),
  overdue: z.boolean().optional().describe('Filter by overdue cards (true=only overdue)'),
  done_on_time: z.boolean().optional().describe('Filter by completed on time (true=only done on time)'),
  with_due_date: z.boolean().optional().describe('Filter cards with due date set (true=only with due date)'),

  // Multiple IDs (comma-separated strings)
  owner_ids: z.string().optional().describe('Filter by multiple owner IDs (comma-separated, e.g., "123,456,789")'),
  member_ids: z.string().optional().describe('Filter by member IDs (comma-separated)'),
  column_ids: z.string().optional().describe('Filter by multiple column IDs (comma-separated)'),
  type_ids: z.string().optional().describe('Filter by multiple type IDs (comma-separated)'),
  tag_ids: z.string().optional().describe('Filter by tag IDs (comma-separated)'),

  // Exclude filters
  exclude_board_ids: z.string().optional().describe('Exclude board IDs (comma-separated)'),
  exclude_owner_ids: z.string().optional().describe('Exclude owner IDs (comma-separated)'),
  exclude_card_ids: z.string().optional().describe('Exclude card IDs (comma-separated)'),

  // Sorting and pagination
  sort_by: z.enum(['created', 'updated', 'title']).optional().describe('Sort field (default: created)'),
  sort_direction: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
  limit: z.number().positive().int().max(500).optional().describe('How many cards to return (default: 10). The API caps a single request at 100, so bigger numbers are paged through honestly; the answer always says whether more were left.'),
  skip: z.number().min(0).int().optional().describe('Number of cards to skip for pagination (default: 0)'),

  // Response control
  verbosity: VerbosityEnum,
}).strict();

export const GetSpaceCardsSchema = z.object({
  space_id: z.number().positive().int().describe('The ID of the space'),
  limit: z.number().positive().int().max(500).optional().describe('How many cards to return (default: 10). Paged in chunks of 100; the answer reports has_more instead of truncating silently.'),
  skip: z.number().min(0).int().optional().describe('Number of cards to skip (default: 0)'),
  condition: z.number().min(1).max(2).optional().describe('Filter by condition: 1=active (default), 2=archived'),
  verbosity: VerbosityEnum,
}).strict();

export const GetBoardCardsSchema = z.object({
  board_id: z.number().positive().int().describe('The ID of the board'),
  limit: z.number().positive().int().max(500).optional().describe('How many cards to return (default: 10). Paged in chunks of 100; the answer reports has_more instead of truncating silently.'),
  skip: z.number().min(0).int().optional().describe('Number of cards to skip (default: 0)'),
  condition: z.number().min(1).max(2).optional().describe('Filter by condition: 1=active (default), 2=archived'),
  verbosity: VerbosityEnum,
}).strict();

// ============================================
// MEMBER / RESPONSIBLE SCHEMAS
// ============================================
//
// The assignee in Kaiten is a card MEMBER with type 2, not the owner. The owner
// is who created or requested the card; workload is counted by the responsible.

export const ListCardMembersSchema = z.object({
  card_id: z.number().positive().int().describe('The card ID'),
}).strict();

export const SetCardResponsibleSchema = z.object({
  card_id: z.number().positive().int().describe('The card ID'),
  user_id: z.number().positive().int().describe('User who becomes responsible (member type 2). Find it with kaiten_list_users.'),
}).strict();

export const RemoveCardResponsibleSchema = z.object({
  card_id: z.number().positive().int().describe('The card ID'),
}).strict();

export const AddCardMemberSchema = z.object({
  card_id: z.number().positive().int().describe('The card ID'),
  user_id: z.number().positive().int().describe('User to add as an ordinary participant (type 1)'),
}).strict();

export const RemoveCardMemberSchema = z.object({
  card_id: z.number().positive().int().describe('The card ID'),
  user_id: z.number().positive().int().describe('User to remove from the card'),
}).strict();

// ============================================
// BLOCKER SCHEMAS
// ============================================

export const ListCardBlockersSchema = z.object({
  card_id: z.number().positive().int().describe('The card ID'),
  include_released: z.boolean().optional().default(false)
    .describe('Also return blockers that were already released (the API returns the full history)'),
}).strict();

export const BlockCardSchema = z.object({
  card_id: z.number().positive().int().describe('The card to block'),
  reason: z.string().min(1).optional().describe('Free-text reason, e.g. "ждём макеты"'),
  blocker_card_id: z.number().positive().int().optional()
    .describe('Block by another card instead of a text reason. 403 "User with id N dont have access to blocker card with id M" means the token cannot see that card.'),
})
  .strict()
  .refine((v) => (v.reason === undefined) !== (v.blocker_card_id === undefined), {
    message: 'Pass exactly one of reason or blocker_card_id',
    path: ['reason'],
  });

export const UnblockCardSchema = z.object({
  card_id: z.number().positive().int().describe('The blocked card'),
  blocker_id: z.number().positive().int().optional()
    .describe('ID of the BLOCKER RECORD (from kaiten_list_card_blockers), not of the blocking card'),
  all: z.boolean().optional().default(false).describe('Release every active blocker of the card'),
})
  .strict()
  .refine((v) => (v.blocker_id !== undefined) !== (v.all === true), {
    message: 'Pass either blocker_id or all: true',
    path: ['blocker_id'],
  });

// ============================================
// ORDERING SCHEMAS
// ============================================

export const SetCardOrderSchema = z.object({
  card_id: z.number().positive().int().describe('The card to move inside its column'),
  before_card_id: z.number().positive().int().optional().describe('Put the card immediately before this one'),
  after_card_id: z.number().positive().int().optional().describe('Put the card immediately after this one'),
  position: z.enum(['top', 'bottom']).optional().describe('Put the card at the top or the bottom of its column'),
  sort_order: z.number().optional().describe('Raw sort_order value, when you know exactly what you want'),
})
  .strict()
  .refine(
    (v) =>
      [v.before_card_id, v.after_card_id, v.position, v.sort_order].filter((x) => x !== undefined).length === 1,
    { message: 'Pass exactly one of before_card_id, after_card_id, position, sort_order', path: ['before_card_id'] }
  );

export const ReorderCardsSchema = z.object({
  card_ids: CardIdsSchema.describe('Cards in the order you want them, top first'),
  start_at: z.number().optional()
    .describe('Renumber from this sort_order instead of reusing the slots the cards already occupy'),
  step: z.number().positive().optional().default(1).describe('Distance between neighbours when start_at is given (default 1)'),
}).strict();

// ============================================
// BULK SCHEMAS
// ============================================

export const BulkMoveCardsSchema = z.object({
  card_ids: CardIdsSchema,
  column_id: z.number().positive().int().optional().describe('Target column (required unless only lane_id changes)'),
  board_id: z.number().positive().int().optional().describe('Target board; then column_id must belong to it'),
  lane_id: z.number().positive().int().optional().describe('Target lane'),
  state: z.number().min(1).max(3).optional()
    .describe('1=queued, 2=in progress, 3=done. Kaiten derives state from the column type, so the column must match; mismatches are reported back.'),
})
  .strict()
  .refine((v) => v.column_id !== undefined || v.lane_id !== undefined || v.board_id !== undefined, {
    message: 'Pass at least one of column_id, lane_id, board_id',
    path: ['column_id'],
  })
  .refine((v) => v.board_id === undefined || v.column_id !== undefined, {
    message: 'column_id is required when board_id is given — columns belong to a board',
    path: ['column_id'],
  });

export const BulkSetDueDateSchema = z.object({
  card_ids: CardIdsSchema,
  due_date: z.string().nullable().describe('ISO date, or null to clear the due date'),
}).strict();

export const BulkSetResponsibleSchema = z.object({
  card_ids: CardIdsSchema,
  user_id: z.number().positive().int().describe('User who becomes responsible on every listed card'),
}).strict();

// ============================================
// CARDS BY PERSON
// ============================================

export const FindCardsByUserSchema = z.object({
  user_id: z.number().positive().int().describe('The person. Find the ID with kaiten_list_users(query="latin name").'),
  role: z.enum(['responsible', 'member', 'any', 'owner']).optional().default('responsible')
    .describe('responsible = member with type 2 (default, this is "the assignee"), member = participant type 1, any = either, owner = who set the task'),
  board_id: z.number().positive().int().optional().describe('Restrict to one board'),
  space_id: z.number().optional().describe('Restrict to one space (0 = all spaces, slow)'),
  state: z.number().min(1).max(3).optional().describe('1=queued, 2=in progress, 3=done'),
  condition: z.number().min(1).max(2).optional().describe('1=active (default), 2=archived'),
  limit: z.number().positive().int().max(500).optional().describe('How many matching cards to return (default 50)'),
  skip: z.number().min(0).int().optional()
    .describe('Resume the scan from this offset — pass the next_offset the previous answer reported'),
  max_scan: z.number().positive().int().max(5000).optional()
    .describe('Cap on cards read while filtering by role (default 500). Cards are read in pages of 100, so the scan can overshoot by up to one page; the answer reports how many were actually scanned.'),
  verbose: VerboseFlag,
}).strict();

// ============================================
// COMMENT SCHEMAS
// ============================================

export const GetCardCommentsSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the card'),
}).strict();

export const CreateCommentSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the card'),
  text: z.string().min(1).describe('The comment text'),
  idempotency_key: IdempotencyKeySchema,
}).strict();

export const UpdateCommentSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the card'),
  comment_id: z.number().positive().int().describe('The ID of the comment to update'),
  text: z.string().min(1).describe('The new comment text'),
  idempotency_key: IdempotencyKeySchema,
}).strict();

export const DeleteCommentSchema = z.object({
  card_id: z.number().positive().int().describe('The ID of the card'),
  comment_id: z.number().positive().int().describe('The ID of the comment to delete'),
}).strict();

// ============================================
// SPACE SCHEMAS
// ============================================

export const GetSpaceSchema = z.object({
  space_id: z.number().positive().int().describe('The ID of the space'),
  format: ResponseFormatEnum,
}).strict();

// ============================================
// BOARD SCHEMAS
// ============================================

export const ListBoardsSchema = z.object({
  space_id: z.number().positive().int().optional().describe('Filter by space ID (optional)'),
  verbosity: VerbosityEnum,
}).strict();

export const GetBoardSchema = z.object({
  board_id: z.number().positive().int().describe('The ID of the board'),
  format: ResponseFormatEnum,
}).strict();

export const UpdateBoardSchema = z.object({
  space_id: z.number().positive().int()
    .describe('Space the board belongs to. Required: boards are read at /boards/{id} but written at /spaces/{space_id}/boards/{id}, and the short path answers 404 on PATCH.'),
  board_id: z.number().positive().int().describe('The board to rename'),
  title: z.string().min(1).max(200).optional().describe('New board title'),
  description: z.string().optional().describe('New board description'),
})
  .strict()
  .refine((v) => v.title !== undefined || v.description !== undefined, {
    message: 'Pass title and/or description',
    path: ['title'],
  });

// ============================================
// BOARD СПРАВОЧНИКИ (COLUMNS, LANES, TYPES)
// ============================================

export const ListColumnsSchema = z.object({
  board_id: z.number().positive().int().describe('The ID of the board'),
}).strict();

export const ListLanesSchema = z.object({
  board_id: z.number().positive().int().describe('The ID of the board'),
}).strict();

export const ListTypesSchema = z.object({
  board_id: z.number().positive().int().describe('The ID of the board'),
}).strict();

// ============================================
// USER SCHEMAS
// ============================================

export const ListUsersSchema = z.object({
  query: z.string().optional().describe('Search query to filter users by email and full_name (server-side filtering)'),
  limit: z.number().positive().int().max(500).optional().describe('How many users to return (default: 100). The API caps one request at 100, so larger values are paged through.'),
  offset: z.number().min(0).int().optional().describe('Number of records to skip for pagination (default: 0)'),
  verbosity: VerbosityEnum,
}).strict();

// GetCurrentUser has no parameters, so no schema needed

// ============================================
// LOGGING SCHEMAS
// ============================================

export const SetLogLevelSchema = z.object({
  level: z.enum(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency', 'off']).describe('New log level'),
  enable_mcp_logs: z.boolean().optional().describe('Enable/disable MCP client logs'),
  enable_file_logs: z.boolean().optional().describe('Enable/disable file logs'),
  enable_request_logs: z.boolean().optional().describe('Enable/disable detailed request logging'),
  enable_metrics: z.boolean().optional().describe('Enable/disable performance metrics collection'),
}).strict();

// ============================================
// TYPES FOR VALIDATED DATA
// ============================================

export type GetCardArgs = z.infer<typeof GetCardSchema>;
export type ListCardAttachmentsArgs = z.infer<typeof ListCardAttachmentsSchema>;
export type GetCardImagesArgs = z.infer<typeof GetCardImagesSchema>;
export type GetTaskContextArgs = z.infer<typeof GetTaskContextSchema>;
export type CreateCardArgs = z.infer<typeof CreateCardSchema>;
export type UpdateCardArgs = z.infer<typeof UpdateCardSchema>;
export type DeleteCardArgs = z.infer<typeof DeleteCardSchema>;
export type AddCardChildArgs = z.infer<typeof AddCardChildSchema>;
export type RemoveCardChildArgs = z.infer<typeof RemoveCardChildSchema>;
export type ListCardChildrenArgs = z.infer<typeof ListCardChildrenSchema>;
export type SearchCardsArgs = z.infer<typeof SearchCardsSchema>;
export type GetSpaceCardsArgs = z.infer<typeof GetSpaceCardsSchema>;
export type GetBoardCardsArgs = z.infer<typeof GetBoardCardsSchema>;
export type GetCardCommentsArgs = z.infer<typeof GetCardCommentsSchema>;
export type CreateCommentArgs = z.infer<typeof CreateCommentSchema>;
export type UpdateCommentArgs = z.infer<typeof UpdateCommentSchema>;
export type DeleteCommentArgs = z.infer<typeof DeleteCommentSchema>;
export type GetSpaceArgs = z.infer<typeof GetSpaceSchema>;
export type ListBoardsArgs = z.infer<typeof ListBoardsSchema>;
export type GetBoardArgs = z.infer<typeof GetBoardSchema>;
export type ListColumnsArgs = z.infer<typeof ListColumnsSchema>;
export type ListLanesArgs = z.infer<typeof ListLanesSchema>;
export type ListTypesArgs = z.infer<typeof ListTypesSchema>;
export type ListUsersArgs = z.infer<typeof ListUsersSchema>;
export type SetLogLevelArgs = z.infer<typeof SetLogLevelSchema>;
export type ListCardMembersArgs = z.infer<typeof ListCardMembersSchema>;
export type SetCardResponsibleArgs = z.infer<typeof SetCardResponsibleSchema>;
export type RemoveCardResponsibleArgs = z.infer<typeof RemoveCardResponsibleSchema>;
export type AddCardMemberArgs = z.infer<typeof AddCardMemberSchema>;
export type RemoveCardMemberArgs = z.infer<typeof RemoveCardMemberSchema>;
export type ListCardBlockersArgs = z.infer<typeof ListCardBlockersSchema>;
export type BlockCardArgs = z.infer<typeof BlockCardSchema>;
export type UnblockCardArgs = z.infer<typeof UnblockCardSchema>;
export type SetCardOrderArgs = z.infer<typeof SetCardOrderSchema>;
export type ReorderCardsArgs = z.infer<typeof ReorderCardsSchema>;
export type BulkMoveCardsArgs = z.infer<typeof BulkMoveCardsSchema>;
export type BulkSetDueDateArgs = z.infer<typeof BulkSetDueDateSchema>;
export type BulkSetResponsibleArgs = z.infer<typeof BulkSetResponsibleSchema>;
export type FindCardsByUserArgs = z.infer<typeof FindCardsByUserSchema>;
export type UpdateBoardArgs = z.infer<typeof UpdateBoardSchema>;
