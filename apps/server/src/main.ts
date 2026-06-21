import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { TransformHttpResponseInterceptor } from './common/interceptors/http-response.interceptor';
import { WsRedisIoAdapter } from './ws/adapter/ws-redis.adapter';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import fastifyIp from 'fastify-ip';
import { InternalLogFilter } from './common/logger/internal-log-filter';
import { EnvironmentService } from './integrations/environment/environment.service';
import { resolveFrameHeader } from './common/helpers';

const CHATGPT_CORS_ORIGINS = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
]);

const CHATGPT_CORS_PATHS = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
  '/api/oauth/register',
  '/api/oauth/token',
  '/mcp',
];

function isChatGptCorsPath(url?: string) {
  return CHATGPT_CORS_PATHS.some((path) => url?.startsWith(path));
}

function applyChatGptCorsHeaders(req: any, reply: any) {
  const origin = req.headers.origin;
  if (
    typeof origin !== 'string' ||
    !CHATGPT_CORS_ORIGINS.has(origin) ||
    !isChatGptCorsPath(req.url)
  ) {
    return false;
  }

  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  reply.header(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
  );
  reply.header(
    'Access-Control-Expose-Headers',
    'Mcp-Session-Id, WWW-Authenticate',
  );

  return true;
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      routerOptions: {
        maxParamLength: 1000,
        ignoreTrailingSlash: true,
        ignoreDuplicateSlashes: true,
      },
    }),
    {
      rawBody: true,
      // captures NestJS internal errors
      logger: new InternalLogFilter(),
      // bufferLogs must be false else pino will fail
      // to log OnApplicationBootstrap logs
      bufferLogs: false,
    },
  );

  app.useLogger(app.get(PinoLogger));

  app.setGlobalPrefix('api', {
    exclude: [
      'robots.txt',
      'share/:shareId/p/:pageSlug',
      'mcp',
      '.well-known/oauth-protected-resource',
      '.well-known/oauth-protected-resource/mcp',
      '.well-known/oauth-authorization-server',
      '.well-known/openid-configuration',
    ],
  });

  const reflector = app.get(Reflector);
  const redisIoAdapter = new WsRedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();

  app.useWebSocketAdapter(redisIoAdapter);

  await app.register(fastifyIp);
  await app.register(fastifyMultipart);
  await app.register(fastifyCookie);

  const environmentService = app.get(EnvironmentService);
  const frameHeader = resolveFrameHeader(
    environmentService.isIframeEmbedAllowed(),
    environmentService.getIframeAllowedOrigins(),
  );
  if (frameHeader) {
    // Skipped routes:
    //   /api/files/ - attachment controller sets its own CSP we'd overwrite
    //   /share/     0 public share pages are safe to embed
    const frameHeaderSkippedPrefixes = ['/api/files/', '/share/'];
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onSend', (req, reply, payload, done) => {
        if (frameHeaderSkippedPrefixes.some((p) => req.url.startsWith(p))) {
          return done(null, payload);
        }
        reply.header(frameHeader.name, frameHeader.value);
        done(null, payload);
      });
  }

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, _reply, done) => {
      (request.raw as any).ip = request.ip;
      done();
    });

  app
    .getHttpAdapter()
    .getInstance()
    .decorateReply('setHeader', function (name: string, value: unknown) {
      this.header(name, value);
    })
    .decorateReply('end', function () {
      this.send('');
    })
    .addHook('preHandler', function (req, reply, done) {
      // don't require workspaceId for the following paths
      const excludedPaths = [
        '/api/auth/setup',
        '/api/health',
        '/api/billing/stripe/webhook',
        '/api/workspace/check-hostname',
        '/api/sso/google',
        '/api/workspace/create',
        '/api/workspace/joined',
        '/api/workspace/find-by-email',
      ];

      if (
        req.originalUrl.startsWith('/api') &&
        !excludedPaths.some((path) => req.originalUrl.startsWith(path))
      ) {
        if (!req.raw?.['workspaceId'] && req.originalUrl !== '/api') {
          throw new NotFoundException('Workspace not found');
        }
        done();
      } else {
        done();
      }
    });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      stopAtFirstError: true,
      transform: true,
    }),
  );

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (req, reply, done) => {
      const matched = applyChatGptCorsHeaders(req, reply);
      if (matched && req.method === 'OPTIONS') {
        reply.code(204).send();
        return;
      }
      done();
    });

  app.enableCors({
    origin: process.env.APP_URL || 'http://localhost:3000',
    credentials: true,
  });

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (req, reply, payload, done) => {
      applyChatGptCorsHeaders(req, reply);
      done(null, payload);
    });

  app.useGlobalInterceptors(new TransformHttpResponseInterceptor(reflector));
  app.enableShutdownHooks();

  const logger = new Logger('NestApplication');

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`UnhandledRejection, reason: ${reason}`, promise);
  });

  process.on('uncaughtException', (error) => {
    logger.error('UncaughtException:', error);
  });

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host, () => {
    logger.log(
      `Listening on http://127.0.0.1:${port} / ${process.env.APP_URL}`,
    );
  });
}

bootstrap();
