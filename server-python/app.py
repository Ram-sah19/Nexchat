import os
import bcrypt
import jwt
import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='../client', static_url_path='')
CORS(app)

# Mongo Setup
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/securechat")
client = MongoClient(MONGO_URI)
db = client.get_database()
users_collection = db.users

JWT_SECRET = os.getenv("JWT_SECRET", "JdXw3ypy3KXjLxfRpNW2LWV4ie3WyxrzCN7YUNAAxvE")

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(app.static_folder, path)

@app.route('/auth/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({'error': 'Missing fields'}), 400

    if users_collection.find_one({'username': username}):
        return jsonify({'error': 'Username taken'}), 400

    hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    users_collection.insert_one({'username': username, 'password': hashed_password})

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
        {'id': str(user['_id']), 'username': username, 'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=10)},
        JWT_SECRET,
        algorithm='HS256'
    )

    return jsonify({'token': token, 'username': username})

if __name__ == '__main__':
    app.run(port=5000, debug=True)
