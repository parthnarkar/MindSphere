import requests
import json

def test_summarize_endpoint():
    base_url = "http://localhost:5000"
    
    # Test data for each section
    test_data = {
        'chat': [
            {"role": "user", "text": "I've been feeling really anxious lately"},
            {"role": "assistant", "text": "I hear that you're experiencing anxiety. Can you tell me more about what's causing these feelings?"},
            {"role": "user", "text": "Mostly school and exams. I can't sleep well."},
        ],
        'peer': [
            {"title": "Dealing with exam stress", "content": "Does anyone have tips for managing exam anxiety? I can't focus on studying."},
            {"title": "Sleep issues", "content": "Having trouble sleeping due to racing thoughts. Any suggestions?"}
        ],
        'resources': [
            {"title": "Anxiety Management Guide", "type": "article", "language": "English"},
            {"title": "Sleep Hygiene Tips", "type": "video", "language": "English"},
            {"title": "Meditation Basics", "type": "audio", "language": "English"}
        ],
        'phq9': [
            {"timestamp": "2025-09-28T10:00:00", "total_score": 12, "answers": [1,2,1,2,1,1,2,1,1]},
            {"timestamp": "2025-09-21T10:00:00", "total_score": 15, "answers": [2,2,2,2,1,2,2,1,1]}
        ]
    }

    print("\nTesting /api/summarize endpoint...")
    
    for section, data in test_data.items():
        print(f"\nTesting {section} section:")
        try:
            response = requests.post(
                f"{base_url}/api/summarize",
                json={"text": data, "section": section}
            )
            
            if response.status_code == 200:
                result = response.json()
                print(f"Success! Generated {len(result.get('points', []))} points:")
                for point in result.get('points', []):
                    print(f"• {point}")
            else:
                print(f"Error! Status code: {response.status_code}")
                print(f"Response: {response.text}")
                
        except Exception as e:
            print(f"Exception occurred: {str(e)}")

if __name__ == "__main__":
    test_summarize_endpoint()