import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

type AiAction =
  | 'improve_writing'
  | 'fix_spelling_grammar'
  | 'make_shorter'
  | 'make_longer'
  | 'simplify'
  | 'change_tone'
  | 'summarize'
  | 'explain'
  | 'continue_writing'
  | 'translate'
  | 'custom';

const ACTION_PROMPTS: Record<AiAction, string> = {
  improve_writing: 'Improve the writing quality of the following text. Return only the improved text.',
  fix_spelling_grammar: 'Fix spelling and grammar errors in the following text. Return only the corrected text.',
  make_shorter: 'Make the following text shorter while keeping the key points. Return only the shortened text.',
  make_longer: 'Expand the following text with more details and explanations. Return only the expanded text.',
  simplify: 'Simplify the following text to make it easier to understand. Return only the simplified text.',
  change_tone: 'Change the tone of the following text to be more professional. Return only the revised text.',
  summarize: 'Summarize the following text concisely. Return only the summary.',
  explain: 'Explain the following text in simple terms. Return only the explanation.',
  continue_writing: 'Continue writing from where the following text ends. Return only the continuation.',
  translate: 'Translate the following text to English (or the detected target language). Return only the translation.',
  custom: '',
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private environmentService: EnvironmentService,
  ) {}

  private getAiConfig() {
    // Read AI configuration from workspace settings or environment
    // For now, check environment variable
    const aiProvider = process.env.AI_PROVIDER || '';
    const aiApiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
    const aiModel = process.env.AI_MODEL || 'gpt-4o-mini';
    const aiBaseUrl = process.env.AI_BASE_URL || '';

    return { aiProvider, aiApiKey, aiModel, aiBaseUrl };
  }

  async getProvider(): Promise<any> {
    const config = this.getAiConfig();
    if (!config.aiApiKey) {
      return null;
    }

    try {
      if (config.aiProvider === 'google' || config.aiApiKey.startsWith('AIza')) {
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        return createGoogleGenerativeAI({ apiKey: config.aiApiKey })(config.aiModel);
      }

      if (config.aiBaseUrl) {
        const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
        return createOpenAICompatible({
          name: 'custom',
          baseURL: config.aiBaseUrl,
          apiKey: config.aiApiKey,
        })(config.aiModel);
      }

      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey: config.aiApiKey })(config.aiModel);
    } catch (err) {
      this.logger.warn('Failed to initialize AI provider', err);
      return null;
    }
  }

  async generate(
    action: AiAction | undefined,
    content: string,
    customPrompt?: string,
  ): Promise<{ content: string; usage?: any }> {
    const model = await this.getProvider();
    if (!model) {
      throw new BadRequestException(
        'AI is not configured. Set AI_API_KEY environment variable.',
      );
    }

    const { generateText } = await import('ai');

    const systemPrompt =
      action === 'custom' && customPrompt
        ? customPrompt
        : ACTION_PROMPTS[action || 'improve_writing'];

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: content,
    });

    return {
      content: result.text,
      usage: result.usage
        ? {
            promptTokens: (result.usage as any).promptTokens ?? 0,
            completionTokens: (result.usage as any).completionTokens ?? 0,
            totalTokens: (result.usage as any).totalTokens ?? 0,
          }
        : undefined,
    };
  }

  async *generateStream(
    action: AiAction | undefined,
    content: string,
    customPrompt?: string,
  ): AsyncGenerator<{ content?: string; error?: string }> {
    const model = await this.getProvider();
    if (!model) {
      yield { error: 'AI is not configured. Set AI_API_KEY environment variable.' };
      return;
    }

    const { streamText } = await import('ai');

    const systemPrompt =
      action === 'custom' && customPrompt
        ? customPrompt
        : ACTION_PROMPTS[action || 'improve_writing'];

    try {
      const result = streamText({
        model,
        system: systemPrompt,
        prompt: content,
      });

      for await (const chunk of result.textStream) {
        yield { content: chunk };
      }
    } catch (err: any) {
      yield { error: err.message || 'AI generation failed' };
    }
  }
}
