import os
import bcrypt
import jwt
import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
from dotenv import load_dotenv
from functools import wraps

load_dotenv()

app = Flask(__name__, static_folder='../client', static_url_path='')
CORS(app)

# ─── Mongo Setup ──────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/securechat")
client = MongoClient(MONGO_URI)
db = client.get_database()
users_collection = db.users
friend_requests_collection = db.friend_requests

JWT_SECRET = os.getenv("JWT_SECRET", "JdXw3ypy3KXjLxfRpNW2LWV4ie3WyxrzCN7YUNAAxvE")


def require_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Missing token'}), 401
        try:
            payload = jwt.decode(auth[7:], JWT_SECRET, algorithms=['HS256'])
            request.username = payload['username']
        except Exception:
            return jsonify({'error': 'Invalid token'}), 401
        return f(*args, **kwargs)
    return decorated


# ─── Static / Frontend ────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(app.static_folder, path)


# ─── Auth Endpoints ───────────────────────────────────────────────────────────
@app.route('/auth/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    public_key = data.get('publicKey')
    encrypted_private_key = data.get('encryptedPrivateKey')

    if not username or not password:
        return jsonify({'error': 'Missing fields'}), 400

    if users_collection.find_one({'username': username}):
        return jsonify({'error': 'Username taken'}), 400

    hashed_password = bcrypt.hashpw(
        password.encode('utf-8'), bcrypt.gensalt()
    ).decode('utf-8')

    users_collection.insert_one({
        'username': username,
        'password': hashed_password,
        'publicKey': public_key,
        'encryptedPrivateKey': encrypted_private_key
    })
    return jsonify({'msg': 'User created successfully'})


@app.route('/auth/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')

    user = users_collection.find_one({'username': username})
    if not user:
        return jsonify({'error': 'User not found'}), 400

    if not bcrypt.checkpw(password.encode('utf-8'), user['password'].encode('utf-8')):
        return jsonify({'error': 'Wrong password'}), 400

    token = jwt.encode(
        {
            'id': str(user['_id']),
            'username': username,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=10)
        },
        JWT_SECRET,
        algorithm='HS256'
    )

    return jsonify({
        'token': token,
        'username': username,
        'publicKey': user.get('publicKey'),
        'encryptedPrivateKey': user.get('encryptedPrivateKey')
    })


@app.route('/auth/keys', methods=['POST'])
@require_token
def update_keys():
    data = request.json
    public_key = data.get('publicKey')
    encrypted_private_key = data.get('encryptedPrivateKey')
    users_collection.update_one(
        {'username': request.username},
        {'$set': {'publicKey': public_key, 'encryptedPrivateKey': encrypted_private_key}}
    )
    return jsonify({'msg': 'Keys updated'})


# ─── Friend System Endpoints ──────────────────────────────────────────────────

@app.route('/friends/status', methods=['GET'])
@require_token
def friend_status():
    """Return full friend state: accepted friends, sent pending, received pending."""
    me = request.username

    # Accepted friendships (I am either sender or receiver)
    accepted_docs = list(friend_requests_collection.find({
        'status': 'accepted',
        '$or': [{'sender': me}, {'receiver': me}]
    }))
    friends = [
        doc['receiver'] if doc['sender'] == me else doc['sender']
        for doc in accepted_docs
    ]

    # Requests I sent that are still pending
    sent_docs = list(friend_requests_collection.find(
        {'sender': me, 'status': 'pending'}
    ))
    pending_sent = [doc['receiver'] for doc in sent_docs]

    # Requests others sent to me that are still pending
    recv_docs = list(friend_requests_collection.find(
        {'receiver': me, 'status': 'pending'}
    ))
    pending_received = [{'sender': doc['sender']} for doc in recv_docs]

    return jsonify({
        'friends': friends,
        'pending_sent': pending_sent,
        'pending_received': pending_received
    })


@app.route('/friends/request', methods=['POST'])
@require_token
def send_friend_request():
    me = request.username
    data = request.json
    receiver = data.get('receiver')

    if not receiver:
        return jsonify({'error': 'Missing receiver'}), 400
    if me == receiver:
        return jsonify({'error': 'Cannot send a request to yourself'}), 400

    # Ensure receiver exists
    if not users_collection.find_one({'username': receiver}):
        return jsonify({'error': 'User not found'}), 404

    # Check if any relationship already exists (in any direction, any status)
    existing = friend_requests_collection.find_one({
        '$or': [
            {'sender': me, 'receiver': receiver},
            {'sender': receiver, 'receiver': me}
        ]
    })
    if existing:
        return jsonify({'error': f'Relationship already exists (status: {existing["status"]})'}), 400

    friend_requests_collection.insert_one({
        'sender': me,
        'receiver': receiver,
        'status': 'pending'
    })

    # Real-time notification is handled by the frontend via WebSocket relay
    return jsonify({'msg': 'Friend request sent'})


@app.route('/friends/accept', methods=['POST'])
@require_token
def accept_friend_request():
    me = request.username
    data = request.json
    sender = data.get('sender')

    if not sender:
        return jsonify({'error': 'Missing sender'}), 400

    result = friend_requests_collection.update_one(
        {'sender': sender, 'receiver': me, 'status': 'pending'},
        {'$set': {'status': 'accepted'}}
    )

    if result.matched_count == 0:
        return jsonify({'error': 'Friend request not found'}), 404

    # Real-time notification is handled by the frontend via WebSocket relay
    return jsonify({'msg': 'Friend request accepted'})


@app.route('/friends/reject', methods=['POST'])
@require_token
def reject_friend_request():
    me = request.username
    data = request.json
    sender = data.get('sender')

    if not sender:
        return jsonify({'error': 'Missing sender'}), 400

    result = friend_requests_collection.update_one(
        {'sender': sender, 'receiver': me, 'status': 'pending'},
        {'$set': {'status': 'rejected'}}
    )

    if result.matched_count == 0:
        return jsonify({'error': 'Friend request not found'}), 404

    return jsonify({'msg': 'Friend request rejected'})


@app.route('/friends/remove', methods=['POST'])
@require_token
def remove_friend():
    """Unfriend: deletes the accepted friendship doc. Java will auto-block messages."""
    me = request.username
    data = request.json
    target = data.get('target')

    if not target:
        return jsonify({'error': 'Missing target'}), 400

    result = friend_requests_collection.delete_one({
        'status': 'accepted',
        '$or': [
            {'sender': me, 'receiver': target},
            {'sender': target, 'receiver': me}
        ]
    })

    if result.deleted_count == 0:
        return jsonify({'error': 'Friendship not found'}), 404

    # Real-time notification is handled by the frontend via WebSocket relay
    return jsonify({'msg': 'Friend removed'})


if __name__ == '__main__':
    app.run(port=5000, debug=True)
