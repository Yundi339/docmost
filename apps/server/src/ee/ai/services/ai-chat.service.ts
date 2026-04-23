import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AiService } from './ai.service';

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private aiService: AiService,
  ) {}

  async createChat(userId: string, workspaceId: string) {
    const [chat] = await this.db
      .insertInto('aiChats')
      .values({ creatorId: userId, workspaceId })
      .returningAll()
      .execute();

    return chat;
  }

  async listChats(
    userId: string,
    workspaceId: string,
    params: { limit?: number; cursor?: string },
  ) {
    const limit = params.limit || 20;

    let query = this.db
      .selectFrom('aiChats')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('creatorId', '=', userId)
      .where('deletedAt', 'is', null);

    if (params.cursor) {
      query = query.where('createdAt', '<', new Date(params.cursor));
    }

    query = query.orderBy('createdAt', 'desc').limit(limit + 1);

    const items = await query.execute();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    return {
      items,
      meta: {
        hasMore,
        cursor:
          hasMore && items.length > 0
            ? items[items.length - 1].createdAt
            : null,
      },
    };
  }

  async getChatInfo(chatId: string, userId: string, workspaceId: string) {
    const chat = await this.db
      .selectFrom('aiChats')
      .selectAll()
      .where('id', '=', chatId)
      .where('workspaceId', '=', workspaceId)
      .where('creatorId', '=', userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!chat) throw new NotFoundException('Chat not found');

    const messages = await this.db
      .selectFrom('aiChatMessages')
      .select([
        'id',
        'chatId',
        'role',
        'content',
        'toolCalls',
        'metadata',
        'createdAt',
      ])
      .where('chatId', '=', chatId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();

    return { chat, messages };
  }

  async deleteChat(chatId: string, userId: string, workspaceId: string) {
    const chat = await this.db
      .selectFrom('aiChats')
      .select('id')
      .where('id', '=', chatId)
      .where('workspaceId', '=', workspaceId)
      .where('creatorId', '=', userId)
      .executeTakeFirst();

    if (!chat) throw new NotFoundException('Chat not found');

    await this.db
      .updateTable('aiChats')
      .set({ deletedAt: new Date() })
      .where('id', '=', chatId)
      .execute();
  }

  async updateChatTitle(
    chatId: string,
    title: string,
    userId: string,
    workspaceId: string,
  ) {
    await this.db
      .updateTable('aiChats')
      .set({ title, updatedAt: new Date() })
      .where('id', '=', chatId)
      .where('workspaceId', '=', workspaceId)
      .where('creatorId', '=', userId)
      .execute();
  }

  async searchChats(query: string, userId: string, workspaceId: string) {
    const chats = await this.db
      .selectFrom('aiChats')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('creatorId', '=', userId)
      .where('deletedAt', 'is', null)
      .where('title', 'ilike', `%${query}%`)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .execute();

    return chats;
  }

  async *sendMessage(
    chatId: string,
    content: string,
    userId: string,
    workspaceId: string,
  ): AsyncGenerator<any> {
    // Create chat if needed
    let actualChatId = chatId;
    if (!actualChatId) {
      const chat = await this.createChat(userId, workspaceId);
      actualChatId = chat.id;
      yield { type: 'chat_created', chatId: actualChatId };
    }

    // Store user message
    await this.db
      .insertInto('aiChatMessages')
      .values({
        chatId: actualChatId,
        workspaceId,
        userId,
        role: 'user',
        content,
      })
      .execute();

    // Get chat history for context
    const history = await this.db
      .selectFrom('aiChatMessages')
      .select(['role', 'content'])
      .where('chatId', '=', actualChatId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();

    // Stream AI response
    const model = await this.aiService.getProvider();
    if (!model) {
      yield {
        type: 'error',
        message: 'AI is not configured. Set AI_API_KEY environment variable.',
        retryable: false,
      };
      return;
    }

    try {
      const { streamText } = await import('ai');

      const messages = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content || '',
      }));

      const result = streamText({
        model,
        system:
          'You are a helpful AI assistant in a document collaboration tool called Docmost. Answer questions clearly and concisely.',
        messages,
      });

      let fullResponse = '';
      for await (const chunk of result.textStream) {
        fullResponse += chunk;
        yield { type: 'content', text: chunk };
      }

      // Store assistant message
      const [assistantMsg] = await this.db
        .insertInto('aiChatMessages')
        .values({
          chatId: actualChatId,
          workspaceId,
          role: 'assistant',
          content: fullResponse,
        })
        .returning('id')
        .execute();

      // Auto-generate title for first message
      const messageCount = history.length;
      if (messageCount <= 2) {
        const title =
          content.length > 60 ? content.substring(0, 60) + '...' : content;
        await this.db
          .updateTable('aiChats')
          .set({ title, updatedAt: new Date() })
          .where('id', '=', actualChatId)
          .execute();
      }

      yield { type: 'done', messageId: assistantMsg.id };
    } catch (err: any) {
      this.logger.error('AI chat stream error', err);
      yield {
        type: 'error',
        message: err.message || 'AI generation failed',
        retryable: true,
      };
    }
  }
}
