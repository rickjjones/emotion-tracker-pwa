# Emotion Tracker PWA

## Overview
The Emotion Tracker PWA is a simple web application that allows users to track their emotions on a scale of 1 to 10. Users can input their emotional ratings for 10 different emotions, and the app will save this data for future reference.

## Features
- Track 10 different emotions.
- Rate each emotion on a scale from 1 to 10.
- Data is stored locally for offline access.
- Progressive Web App capabilities, including service worker for caching.

## Project Structure
```
emotion-tracker-pwa
├── src
│   ├── index.html        # Main HTML document for the PWA
│   ├── app.js           # JavaScript logic for handling user input and data storage
│   └── styles.css       # CSS styles for the PWA
├── sw.js                # Service worker for caching and offline functionality
├── manifest.json        # Web app manifest for metadata
├── package.json         # npm configuration file
└── README.md            # Project documentation
```

## Getting Started

### Prerequisites
- A modern web browser that supports PWA features.
- Basic knowledge of HTML, CSS, and JavaScript.

### Installation
1. Clone the repository or download the project files.
2. Open the `index.html` file in your web browser to run the application.

### Usage
- Open the app and rate your emotions on a scale of 1 to 10.
- Your ratings will be saved locally, allowing you to track changes over time.

### Contributing
Feel free to submit issues or pull requests if you have suggestions for improvements or new features.

### License
This project is open-source and available under the MIT License.