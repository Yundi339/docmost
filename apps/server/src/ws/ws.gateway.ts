import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TokenService } from '../core/auth/services/token.service';
import { JwtPayload, JwtType } from '../core/auth/dto/jwt-payload';
import { OnModuleDestroy } from '@nestjs/common';
import { WsService } from './ws.service';
import { getSpaceRoomName, getUserRoomName } from './ws.utils';
import * as cookie from 'cookie';

@WebSocketGateway({
  cors: { origin: process.env.APP_URL || 'http://localhost:3000' },
  transports: ['websocket'],
})
export class WsGateway
  implements OnGatewayConnection, OnGatewayInit, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  constructor(
    private tokenService: TokenService,
    private wsService: WsService,
  ) {}

  afterInit(server: Server): void {
    this.wsService.setServer(server);
  }

  async handleConnection(client: Socket, ...args: any[]): Promise<void> {
    try {
      const cookies = cookie.parse(client.handshake.headers.cookie ?? '');
      const token: JwtPayload = await this.tokenService.verifyJwt(
        cookies['authToken'],
        JwtType.ACCESS,
      );

      const context = await this.wsService.authenticateConnection(token);
      const { userId, workspaceId, sessionId, spaceIds } = context;

      client.data.userId = userId;
      client.data.workspaceId = workspaceId;
      client.data.sessionId = sessionId;
      client.data.lastSecurityValidatedAt = Date.now();

      const userRoom = getUserRoomName(userId);
      const workspaceRoom = `workspace-${workspaceId}`;
      const spaceRooms = spaceIds.map((id) => getSpaceRoomName(id));

      await client.join([userRoom, workspaceRoom, ...spaceRooms]);
    } catch (err) {
      client.emit('Unauthorized');
      client.disconnect();
    }
  }

  @SubscribeMessage('message')
  async handleMessage(client: Socket, data: any): Promise<void> {
    if (!(await this.wsService.revalidateSocket(client))) return;
    if (this.wsService.isClientTreeRefreshEvent(data)) {
      await this.wsService.handleClientTreeRefresh(client, data.spaceId);
    }
  }

  /*
  @SubscribeMessage('join-room')
  handleJoinRoom(client: Socket, @MessageBody() roomName: string): void {
    // if room is a space, check if user has permissions
    //client.join(roomName);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(client: Socket, @MessageBody() roomName: string): void {
    client.leave(roomName);
  }
 */

  onModuleDestroy() {
    if (this.server) {
      this.server.close();
    }
  }
}
