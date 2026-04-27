package chat;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.model.Filters;
import com.mongodb.client.model.Sorts;
import com.mongodb.client.model.Updates;
import org.bson.Document;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONArray;
import org.json.JSONObject;

import org.bson.types.ObjectId;

import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class ChatServer extends WebSocketServer {

    private final String JWT_SECRET = "JdXw3ypy3KXjLxfRpNW2LWV4ie3WyxrzCN7YUNAAxvE";

    // username → active WebSocket connection
    private final Map<String, WebSocket> activeUsers = new ConcurrentHashMap<>();
    // WebSocket → username
    private final Map<WebSocket, String> socketToUser = new ConcurrentHashMap<>();

    private MongoClient mongoClient;
    private MongoDatabase database;
    private MongoCollection<Document> usersCollection;
    private MongoCollection<Document> messagesCollection;
    private MongoCollection<Document> friendRequestsCollection;
    private MongoCollection<Document> callsCollection;

    // callKey(A,B) → { docId, caller, callee, answered, startedAt, answeredAt }
    private final Map<String, JSONObject> activeCalls = new ConcurrentHashMap<>();

    public ChatServer(int port) {
        super(new InetSocketAddress(port));
        initMongo();
        // No internal HTTP server needed — frontend relays all social events via WS
    }

    // ─── MongoDB Init ──────────────────────────────────────────────────────────
    private void initMongo() {
        mongoClient = MongoClients.create("mongodb://localhost:27017");
        database = mongoClient.getDatabase("securechat");
        usersCollection = database.getCollection("users");
        messagesCollection = database.getCollection("messages");
        friendRequestsCollection = database.getCollection("friend_requests");
        callsCollection = database.getCollection("calls");
        System.out.println("Connected to MongoDB from Java Server.");
    }

    /** Normalised key so (A,B) == (B,A). */
    private String callKey(String a, String b) {
        return a.compareTo(b) < 0 ? a + ":" + b : b + ":" + a;
    }

    // ─── WebSocket Lifecycle ───────────────────────────────────────────────────
    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        String resource = handshake.getResourceDescriptor();
        String token = null;

        if (resource.contains("token=")) {
            token = resource.split("token=")[1].split("&")[0];
        }

        if (token == null) {
            conn.close(4001, "Authentication error: No token");
            return;
        }

        try {
            DecodedJWT jwt = JWT.require(Algorithm.HMAC256(JWT_SECRET)).build().verify(token);
            String username = jwt.getClaim("username").asString();
            socketToUser.put(conn, username);
            System.out.println("User connected: " + username);
        } catch (Exception e) {
            conn.close(4001, "Authentication error: Invalid token");
        }
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        String username = socketToUser.remove(conn);
        if (username != null) {
            activeUsers.remove(username);
            System.out.println("User disconnected: " + username);
            broadcastUserList();
            broadcastOnlineUsers();
        }
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        String username = socketToUser.get(conn);
        if (username == null) return;

        try {
            JSONObject req = new JSONObject(message);
            String type = req.getString("type");
            JSONObject payload = req.optJSONObject("payload");
            if (payload == null) payload = new JSONObject();

            switch (type) {
                // ── Existing chat events ──
                case "join":
                    handleJoin(username, conn, payload);
                    break;
                case "request_public_key":
                    handleRequestPublicKey(conn, payload, req.optString("reqId"));
                    break;
                case "send_message":
                    handleSendMessage(username, conn, payload);
                    break;
                case "fetch_history":
                    handleFetchHistory(username, conn, payload, req.optString("reqId"));
                    break;

                // ── Friend system relay events ──
                case "friend_request_sent":
                    // Alice just added Bob — relay a live alert to Bob
                    handleFriendRequestSent(username, payload);
                    break;
                case "friend_request_accepted":
                    // Bob accepted — ping BOTH sides to move to "My Friends" instantly
                    handleFriendRequestAccepted(username, payload);
                    break;
                case "friend_removed_notify":
                    // Someone unfriended — tell the other person live
                    handleFriendRemovedNotify(username, payload);
                    break;

                // ── WebRTC Call Signalling (relay + history recording) ──
                case "call_offer":
                    if (handleCallSignal("call_offer", username, payload))
                        recordCallStart(username, payload);
                    break;
                case "call_answer":
                    handleCallSignal("call_answer", username, payload);
                    recordCallAnswer(username, payload);
                    break;
                case "call_ice":
                    handleCallSignal("call_ice", username, payload);
                    break;
                case "call_ended":
                    handleCallSignalNoFriendCheck("call_ended", username, payload);
                    recordCallEnd(username, payload);
                    break;

                // ── Call History ─────────────────────────────────────────
                case "fetch_call_history":
                    handleFetchCallHistory(username, conn, payload, req.optString("reqId"));
                    break;

                // ── Message Receipt Ticks ──────────────────────────────────
                // Receiver sends these back to the original sender so the
                // sender's UI can upgrade their tick icons (delivered / seen).
                case "message_delivered":
                case "message_seen":
                    handleReceiptRelay(type, username, payload);
                    break;

                // ── Typing indicator relay ────────────────────────────────
                case "typing":
                    handleTypingRelay(username, payload);
                    break;

                default:
                    System.out.println("Unknown event type: " + type);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // ─── Chat Handlers ─────────────────────────────────────────────────────────
    private void handleJoin(String username, WebSocket conn, JSONObject payload) {
        String publicKey = payload.getJSONObject("publicKey").toString();
        boolean isNewKey = payload.optBoolean("isNewKey", false);

        activeUsers.put(username, conn);

        // Only overwrite the stored public key when the client generated a fresh pair.
        // For existing sessions the key is unchanged — updating would break old message decryption.
        if (isNewKey) {
            usersCollection.updateOne(
                Filters.eq("username", username),
                Updates.set("publicKey", publicKey)
            );
            System.out.println(username + " registered NEW public key for session.");
        } else {
            System.out.println(username + " resumed session with existing public key.");
        }

        broadcastUserList();
        broadcastOnlineUsers();
    }

    /** Broadcasts all registered users (powers the "All Users" discovery panel). */
    private void broadcastUserList() {
        JSONArray allUsers = new JSONArray();
        for (Document doc : usersCollection.find()) {
            allUsers.put(doc.getString("username"));
        }
        JSONObject msg = new JSONObject();
        msg.put("type", "user_list");
        msg.put("payload", allUsers);
        broadcast(msg.toString());
    }

    /** Broadcasts only currently connected users (powers the online status dots). */
    private void broadcastOnlineUsers() {
        JSONArray onlineUsers = new JSONArray();
        for (String u : activeUsers.keySet()) {
            onlineUsers.put(u);
        }
        JSONObject msg = new JSONObject();
        msg.put("type", "online_users");
        msg.put("payload", onlineUsers);
        broadcast(msg.toString());
    }

    /** Checks MongoDB to verify two users have an accepted friendship. */
    private boolean areFriends(String userA, String userB) {
        Document doc = friendRequestsCollection.find(
            Filters.and(
                Filters.eq("status", "accepted"),
                Filters.or(
                    Filters.and(Filters.eq("sender", userA), Filters.eq("receiver", userB)),
                    Filters.and(Filters.eq("sender", userB), Filters.eq("receiver", userA))
                )
            )
        ).first();
        return doc != null;
    }

    private void handleRequestPublicKey(WebSocket conn, JSONObject payload, String reqId) {
        String receiver = payload.getString("receiver");
        Document doc = usersCollection.find(Filters.eq("username", receiver)).first();

        JSONObject responsePayload = new JSONObject();
        if (doc != null && doc.getString("publicKey") != null) {
            responsePayload.put("publicKey", new JSONObject(doc.getString("publicKey")));
        } else {
            responsePayload.put("error", "User offline or key not available");
        }

        JSONObject msg = new JSONObject();
        msg.put("type", "public_key_response");
        msg.put("reqId", reqId);
        msg.put("payload", responsePayload);
        conn.send(msg.toString());
    }

    private void handleSendMessage(String sender, WebSocket conn, JSONObject payload) {
        String receiver = payload.getString("receiver");

        // ── Security Guard: block messages between non-friends ────────────────
        if (!areFriends(sender, receiver)) {
            JSONObject errorMsg = new JSONObject();
            errorMsg.put("type", "error");
            JSONObject errorPayload = new JSONObject();
            errorPayload.put("message", "You must be friends with " + receiver + " to chat!");
            errorMsg.put("payload", errorPayload);
            conn.send(errorMsg.toString());
            System.out.println("BLOCKED: " + sender + " → " + receiver + " (not friends)");
            return;
        }

        JSONArray ciphertext = payload.getJSONArray("ciphertext");
        JSONArray iv = payload.getJSONArray("iv");
        long timestamp = System.currentTimeMillis();

        Document newMsg = new Document()
                .append("sender", sender)
                .append("receiver", receiver)
                .append("ciphertext", ciphertext.toList())
                .append("iv", iv.toList())
                .append("timestamp", timestamp)
                .append("status", "sent");

        messagesCollection.insertOne(newMsg);
        String msgId = newMsg.getObjectId("_id").toHexString();

        WebSocket receiverConn = activeUsers.get(receiver);
        if (receiverConn != null) {
            messagesCollection.updateOne(
                Filters.eq("_id", newMsg.getObjectId("_id")),
                Updates.set("status", "delivered")
            );
            JSONObject rxMsg = new JSONObject();
            rxMsg.put("type", "receive_message");
            JSONObject rxPayload = new JSONObject();
            rxPayload.put("_id", msgId);
            rxPayload.put("sender", sender);
            rxPayload.put("ciphertext", ciphertext);
            rxPayload.put("iv", iv);
            rxPayload.put("timestamp", timestamp);
            rxMsg.put("payload", rxPayload);
            receiverConn.send(rxMsg.toString());
        } else {
            System.out.println("Message saved offline for " + receiver);
        }
    }

    private void handleFetchHistory(String username, WebSocket conn, JSONObject payload, String reqId) {
        String withUser = payload.getString("withUser");

        List<Document> msgs = new ArrayList<>();
        messagesCollection.find(
            Filters.or(
                Filters.and(Filters.eq("sender", username), Filters.eq("receiver", withUser)),
                Filters.and(Filters.eq("sender", withUser), Filters.eq("receiver", username))
            )
        ).sort(Sorts.ascending("timestamp")).into(msgs);

        JSONArray history = new JSONArray();
        for (Document d : msgs) {
            JSONObject m = new JSONObject();
            m.put("sender", d.getString("sender"));
            m.put("receiver", d.getString("receiver"));
            m.put("ciphertext", new JSONArray(d.getList("ciphertext", Object.class)));
            m.put("iv", new JSONArray(d.getList("iv", Object.class)));
            m.put("timestamp", d.getLong("timestamp"));
            history.put(m);
        }

        JSONObject msg = new JSONObject();
        msg.put("type", "history_response");
        msg.put("reqId", reqId);
        msg.put("payload", history);
        conn.send(msg.toString());
    }

    // ─── Friend System Relay Handlers ──────────────────────────────────────────

    /**
     * Alice's frontend sends { type: "friend_request_sent", payload: { to: "Bob" } }.
     * Java relays a live alert to Bob if he is online.
     */
    private void handleFriendRequestSent(String sender, JSONObject payload) {
        String to = payload.optString("to", "");

        WebSocket targetConn = activeUsers.get(to);
        if (targetConn != null && targetConn.isOpen()) {
            JSONObject msg = new JSONObject();
            msg.put("type", "new_friend_request");
            JSONObject wsPayload = new JSONObject();
            wsPayload.put("from", sender);
            msg.put("payload", wsPayload);
            targetConn.send(msg.toString());
            System.out.println("LIVE: friend request relayed " + sender + " → " + to);
        } else {
            System.out.println("QUEUED: " + to + " is offline, request saved in DB only.");
        }
    }

    /**
     * Bob's frontend sends { type: "friend_request_accepted", payload: { to: "Alice" } }.
     * Java fires `friendship_activated` to BOTH Alice and Bob so both UIs update instantly.
     *
     *   Alice receives: { type: "friendship_activated", payload: { with: "Bob" } }
     *   Bob receives:   { type: "friendship_activated", payload: { with: "Alice" } }
     */
    private void handleFriendRequestAccepted(String accepter, JSONObject payload) {
        String originalSender = payload.optString("to", ""); // person who sent the initial request

        // Notify the original sender (e.g., Alice) that Bob accepted
        sendFriendshipActivated(originalSender, accepter);

        // Also notify the accepter (Bob) themselves — confirms both sides atomically
        sendFriendshipActivated(accepter, originalSender);

        System.out.println("LIVE: friendship activated — " + accepter + " ↔ " + originalSender);
    }

    /** Sends `friendship_activated` to `username`, telling them they are now friends with `friendName`. */
    private void sendFriendshipActivated(String username, String friendName) {
        WebSocket conn = activeUsers.get(username);
        if (conn != null && conn.isOpen()) {
            JSONObject msg = new JSONObject();
            msg.put("type", "friendship_activated");
            JSONObject wsPayload = new JSONObject();
            wsPayload.put("with", friendName);
            msg.put("payload", wsPayload);
            conn.send(msg.toString());
        }
    }

    /**
     * Remover's frontend sends { type: "friend_removed_notify", payload: { to: "target" } }.
     * Java tells the unfriended person live.
     */
    private void handleFriendRemovedNotify(String remover, JSONObject payload) {
        String to = payload.optString("to", "");

        WebSocket targetConn = activeUsers.get(to);
        if (targetConn != null && targetConn.isOpen()) {
            JSONObject msg = new JSONObject();
            msg.put("type", "friend_removed");
            JSONObject wsPayload = new JSONObject();
            wsPayload.put("from", remover);
            msg.put("payload", wsPayload);
            targetConn.send(msg.toString());
            System.out.println("LIVE: unfriend relayed " + remover + " → " + to);
        }
    }

    // ─── Message Receipt Relay (ticks) ─────────────────────────────────────────

    /**
     * Receiver calls message_delivered / message_seen with { to: originalSender }.
     * We relay it to the originalSender so their client updates the tick icon.
     */
    private void handleReceiptRelay(String signalType, String receiver, JSONObject payload) {
        String originalSender = payload.optString("to", "");
        if (originalSender.isEmpty()) return;

        WebSocket senderConn = activeUsers.get(originalSender);
        if (senderConn != null && senderConn.isOpen()) {
            JSONObject msg = new JSONObject();
            msg.put("type", signalType);
            JSONObject wp = new JSONObject();
            wp.put("from", receiver);   // tells sender: "this person saw your messages"
            msg.put("payload", wp);
            senderConn.send(msg.toString());
        }
    }

    // ─── Typing Indicator Relay ────────────────────────────────────────────────

    /**
     * Relays { isTyping, from } to the target user.
     * No friendship check needed — if they can chat, they can see typing status.
     */
    private void handleTypingRelay(String sender, JSONObject payload) {
        String to = payload.optString("to", "");
        if (to.isEmpty()) return;

        WebSocket targetConn = activeUsers.get(to);
        if (targetConn != null && targetConn.isOpen()) {
            JSONObject msg = new JSONObject();
            msg.put("type", "typing");
            JSONObject wp = new JSONObject();
            wp.put("from",     sender);
            wp.put("isTyping", payload.optBoolean("isTyping", false));
            msg.put("payload", wp);
            targetConn.send(msg.toString());
        }
    }

    // ─── WebRTC Call Signal Relay ──────────────────────────────────────────────

    /**
     * Generic relay for call_offer / call_answer / call_ice.
     * Requires an active friendship — blocks calls between strangers.
     *
     * The payload must contain a "to" field with the target username.
     * We add a "from" field so the receiver knows who sent it.
     */
    private boolean handleCallSignal(String signalType, String sender, JSONObject payload) {
        String to = payload.optString("to", "");
        if (to.isEmpty()) return false;

        if (!areFriends(sender, to)) {
            JSONObject err = new JSONObject();
            err.put("type", "error");
            JSONObject ep = new JSONObject();
            ep.put("message", "You must be friends to call " + to);
            err.put("payload", ep);
            WebSocket senderConn = activeUsers.get(sender);
            if (senderConn != null && senderConn.isOpen()) senderConn.send(err.toString());
            return false;
        }

        WebSocket targetConn = activeUsers.get(to);
        if (targetConn == null || !targetConn.isOpen()) {
            WebSocket senderConn = activeUsers.get(sender);
            if (senderConn != null && senderConn.isOpen()) {
                JSONObject err = new JSONObject();
                err.put("type", "error");
                JSONObject ep = new JSONObject();
                ep.put("message", to + " is not online right now.");
                err.put("payload", ep);
                senderConn.send(err.toString());
            }
            return false;
        }

        JSONObject relay = new JSONObject();
        relay.put("type", signalType);
        payload.put("from", sender);
        relay.put("payload", payload);
        targetConn.send(relay.toString());
        System.out.println("CALL RELAY [" + signalType + "]: " + sender + " → " + to);
        return true;
    }

    /**
     * Relay for call_ended — skips the friends check so that a declined/cancelled
     * call can still reach the other side even in edge cases.
     */
    private void handleCallSignalNoFriendCheck(String signalType, String sender, JSONObject payload) {
        String to = payload.optString("to", "");
        if (to.isEmpty()) return;

        WebSocket targetConn = activeUsers.get(to);
        if (targetConn != null && targetConn.isOpen()) {
            JSONObject relay = new JSONObject();
            relay.put("type", signalType);
            payload.put("from", sender);
            relay.put("payload", payload);
            targetConn.send(relay.toString());
            System.out.println("CALL RELAY [" + signalType + "]: " + sender + " → " + to);
        }
    }

    // ─── Call History Recording ────────────────────────────────────────────────────────

    /** Insert a new call record with status "ringing". */
    private void recordCallStart(String caller, JSONObject payload) {
        String callee   = payload.optString("to", "");
        boolean isVideo = payload.optBoolean("withVideo", false);
        long startedAt  = System.currentTimeMillis();

        Document doc = new Document()
            .append("caller",    caller)
            .append("callee",    callee)
            .append("type",      isVideo ? "video" : "voice")
            .append("status",    "ringing")
            .append("startedAt", startedAt)
            .append("duration",  0);
        callsCollection.insertOne(doc);

        JSONObject state = new JSONObject();
        state.put("docId",     doc.getObjectId("_id").toHexString());
        state.put("caller",    caller);
        state.put("callee",    callee);
        state.put("answered",  false);
        state.put("startedAt", startedAt);
        activeCalls.put(callKey(caller, callee), state);
        System.out.println("CALL RECORD [start]: " + caller + " → " + callee);
    }

    /** Mark the call as answered. */
    private void recordCallAnswer(String callee, JSONObject payload) {
        String caller  = payload.optString("to", "");
        JSONObject state = activeCalls.get(callKey(caller, callee));
        if (state == null) return;

        long answeredAt = System.currentTimeMillis();
        state.put("answered",   true);
        state.put("answeredAt", answeredAt);
        callsCollection.updateOne(
            Filters.eq("_id", new ObjectId(state.getString("docId"))),
            Updates.combine(Updates.set("status", "in_progress"),
                            Updates.set("answeredAt", answeredAt))
        );
        System.out.println("CALL RECORD [answered]: " + caller + " ↔ " + callee);
    }

    /** Finalise the call: calculate duration, set status to completed or missed. */
    private void recordCallEnd(String sender, JSONObject payload) {
        String other   = payload.optString("to", "");
        JSONObject state = activeCalls.remove(callKey(sender, other));
        if (state == null) return;

        long   endedAt  = System.currentTimeMillis();
        boolean answered = state.optBoolean("answered", false);
        int    duration = 0;
        String status;

        if (answered) {
            long answeredAt = state.optLong("answeredAt", endedAt);
            duration = (int) ((endedAt - answeredAt) / 1000);
            status   = "completed";
        } else {
            status = "missed";
        }

        callsCollection.updateOne(
            Filters.eq("_id", new ObjectId(state.getString("docId"))),
            Updates.combine(Updates.set("status",   status),
                            Updates.set("endedAt",  endedAt),
                            Updates.set("duration", duration))
        );
        System.out.println("CALL RECORD [end]: " + status + " (" + duration + "s)");
    }

    /** Returns all calls between two users, sorted oldest-first. */
    private void handleFetchCallHistory(String username, WebSocket conn,
                                        JSONObject payload, String reqId) {
        String withUser = payload.optString("withUser", "");
        List<Document> docs = new ArrayList<>();
        callsCollection.find(
            Filters.or(
                Filters.and(Filters.eq("caller", username), Filters.eq("callee", withUser)),
                Filters.and(Filters.eq("caller", withUser), Filters.eq("callee", username))
            )
        ).sort(Sorts.ascending("startedAt")).into(docs);

        JSONArray history = new JSONArray();
        for (Document d : docs) {
            JSONObject c = new JSONObject();
            c.put("caller",    d.getString("caller"));
            c.put("callee",    d.getString("callee"));
            c.put("type",      d.getString("type"));
            c.put("status",    d.getString("status"));
            c.put("duration",  d.getInteger("duration", 0));
            c.put("startedAt", d.getLong("startedAt"));
            history.put(c);
        }

        JSONObject msg = new JSONObject();
        msg.put("type",    "call_history_response");
        msg.put("reqId",   reqId);
        msg.put("payload", history);
        conn.send(msg.toString());
    }

    // ─── Error / Start ─────────────────────────────────────────────────────────
    @Override
    public void onError(WebSocket conn, Exception ex) {
        System.err.println("An error occurred on connection");
        ex.printStackTrace();
    }

    @Override
    public void onStart() {
        System.out.println("Java WebSocket server started on port " + getPort());
    }
}
