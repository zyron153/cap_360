import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server } from "socket.io";

/** Carries only the conversation id, never message content — the socket is unauthenticated (same
 * as the calendar gateway), so clients refetch through the authenticated REST API instead. */
@WebSocketGateway({ namespace: "/whatsapp", cors: { origin: "*" } })
export class WhatsappGateway {
  @WebSocketServer()
  server!: Server;

  emitUpdated(conversationId: string) {
    this.server?.emit("whatsapp:updated", { conversationId });
  }
}
