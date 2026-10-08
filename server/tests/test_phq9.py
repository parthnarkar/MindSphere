"""Offline PHQ-9 request and persistence regression tests."""
import importlib
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Disable dotenv and startup integrations before importing the real Flask app.
with patch('dotenv.load_dotenv'), patch.dict('os.environ', {
    'MONGO_URI': '', 'GEMINI_API_KEY': '', 'MODEL_NAME': ''
}):
    from utils import db, model
    with patch.object(db, 'init_mongo'), patch.object(model, 'init_model'):
        app_module = importlib.import_module('app')


class Phq9Tests(unittest.TestCase):
    def setUp(self):
        self.client = app_module.app.test_client()
        self.store = []
        memory = patch.object(db, 'phq9_in_memory', self.store, create=True)
        collection = patch.object(db, 'phq9_collection', None)
        memory.start()
        collection.start()
        self.addCleanup(memory.stop)
        self.addCleanup(collection.stop)

    def submit(self, answers, email='Student@Example.test'):
        return self.client.post('/api/phq9', json={
            'user_email': email, 'answers': answers
        })

    def test_valid_submissions_in_both_storage_modes(self):
        for answers in ([0] * 9, [3] * 9, [0, 1, 2, 3, 0, 1, 2, 3, 1],
                        ['0', '1', '2', '3', '0', '1', '2', '3', '1']):
            expected = [int(answer) for answer in answers]
            for database in (False, True):
                with self.subTest(answers=answers, database=database):
                    self.store.clear()
                    coll = Mock() if database else None
                    with patch.object(db, 'phq9_collection', coll):
                        response = self.submit(answers)
                    self.assertEqual(response.status_code, 201)
                    if database:
                        coll.insert_one.assert_called_once()
                        doc = coll.insert_one.call_args.args[0]
                        self.assertEqual(response.get_json(), {'ok': True})
                        self.assertEqual(self.store, [])
                    else:
                        self.assertEqual(len(self.store), 1)
                        doc = self.store[0]
                        self.assertEqual(set(response.get_json()), {
                            'user_email', 'timestamp', 'answers', 'total_score'
                        })
                        self.assertEqual(response.get_json()['total_score'], sum(expected))
                    self.assertEqual(doc['user_email'], 'student@example.test')
                    self.assertEqual(doc['answers'], expected)
                    self.assertEqual(doc['total_score'], sum(expected))
                    self.assertTrue(all(type(answer) is int for answer in doc['answers']))
                    self.assertIsNotNone(doc['timestamp'])

    def assert_invalid(self, **request):
        for database in (False, True):
            with self.subTest(database=database):
                coll = Mock() if database else None
                with patch.object(db, 'phq9_collection', coll), \
                        patch.object(db, 'insert_phq9', wraps=db.insert_phq9) as insert:
                    response = self.client.post('/api/phq9', **request)
                self.assertEqual(response.status_code, 400, response.get_json())
                payload = response.get_json()
                self.assertEqual(set(payload), {'error'})
                self.assertIsInstance(payload['error'], str)
                self.assertTrue(payload['error'])
                insert.assert_not_called()
                if coll is not None:
                    coll.insert_one.assert_not_called()
                self.assertEqual(self.store, [])

    def test_invalid_answers(self):
        for value in (-1, 4, 1.5, 1.0, True, False, None, {}, [],
                      '-1', '4', '1.5', '', 'invalid'):
            with self.subTest(value=value):
                self.assert_invalid(json={
                    'user_email': 'student@example.test', 'answers': [value] + [0] * 8
                })

    def test_answer_shape_and_missing_fields(self):
        for answers in (None, '000000000', {}, [], [0] * 8, [0] * 10):
            with self.subTest(answers=answers):
                self.assert_invalid(json={'user_email': 'student@example.test', 'answers': answers})
        for body in ({}, {'answers': [0] * 9}, {'user_email': 'student@example.test'}):
            with self.subTest(body=body):
                self.assert_invalid(json=body)

    def test_invalid_email(self):
        for email in (None, '', '   ', '\t\n', 123, True, [], {}):
            with self.subTest(email=email):
                self.assert_invalid(json={'user_email': email, 'answers': [0] * 9})

    def test_non_object_json(self):
        for body in ([], [1], 'text', 123, True, False):
            with self.subTest(body=body):
                self.assert_invalid(json=body)
        self.assert_invalid(data='null', content_type='application/json')

    def test_malformed_or_missing_json(self):
        for body in ('{', '{"answers":', ''):
            with self.subTest(body=body):
                self.assert_invalid(data=body, content_type='application/json')
        self.assert_invalid(data='plain text', content_type='text/plain')


if __name__ == '__main__':
    unittest.main()
