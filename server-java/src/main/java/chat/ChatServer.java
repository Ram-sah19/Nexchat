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

import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class ChatServer extends WebSocketServer {

    private final String JWT_SECRET = "JdXw3ypy3KXjLxfRpNW2LWV4ie3WyxrzCN7YUNAAxvE";
    private final Map<String, WebSocket> activeUsers = new ConcurrentHashMap<>();
    private final Map<WebSocket, String> socketToUser = new ConcurrentHashMap<>();

    private MongoClient mongoClient;
    private MongoDatabase database;
    private MongoCollection<Document> usersCollection;
    private MongoCollection<Document> messagesCollection;

    public ChatServer(int port) {
        super(new InetSocketAddress(port));
        initMongo();
    }

    private void initMongo() {
        mongoClient = MongoClients.create("mongodb://localhost:27017");
        database = mongoClient.getDatabase("securechat");
        usersCollection = database.getCollection("users");
        messagesCollection = database.getCollection("messages");
        System.out.println("Connected to MongoDB from Java Server.");
    }

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
                default:
                    System.out.println("Unknown event type: " + type);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void handleJoin(String username, WebSocket conn, JSONObject payload) {
        String publicKey = payload.getJSONObject("publicKey").toString();
        activeUsers.put(username, conn);
        usersCollection.updateOne(Filters.eq("username", username), Updates.set("publicKey", publicKey));
        System.out.println(username + " registered public key for session.");
        broadcastUserList();
    }

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
            messagesCollection.updateOne(Filters.eq("_id", newMsg.getObjectId("_id")), Updates.set("status", "delivered"));
            
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

    @Override
    public void onError(WebSocket conn, Exception ex) {
        System.err.println("An error occurred on connection");
        ex.printStackTrace();
    }

    @Override
    public void onStart() {
        System.out.println("Java WebSocket server started successfully on port " + getPort());
    }
}
