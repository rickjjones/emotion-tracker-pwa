const emotions = [
    { name: "Happiness", value: 0 },
    { name: "Sadness", value: 0 },
    { name: "Anger", value: 0 },
    { name: "Fear", value: 0 },
    { name: "Surprise", value: 0 },
    { name: "Disgust", value: 0 },
    { name: "Anticipation", value: 0 },
    { name: "Trust", value: 0 },
    { name: "Joy", value: 0 },
    { name: "Love", value: 0 }
];

function init() {
    loadEmotions();
    renderEmotions();
    document.getElementById("emotion-form").addEventListener("submit", saveEmotions);
}

function loadEmotions() {
    const storedEmotions = JSON.parse(localStorage.getItem("emotions"));
    if (storedEmotions) {
        emotions.forEach((emotion, index) => {
            emotion.value = storedEmotions[index].value;
        });
    }
}

function saveEmotions(event) {
    event.preventDefault();
    emotions.forEach((emotion, index) => {
        const input = document.getElementById(`emotion-${index}`);
        emotion.value = parseInt(input.value) || 0;
    });
    localStorage.setItem("emotions", JSON.stringify(emotions));
    renderEmotions();
}

function renderEmotions() {
    const emotionList = document.getElementById("emotion-list");
    emotionList.innerHTML = "";
    emotions.forEach((emotion, index) => {
        const listItem = document.createElement("li");
        listItem.textContent = `${emotion.name}: ${emotion.value}`;
        emotionList.appendChild(listItem);
    });
}

document.addEventListener("DOMContentLoaded", init);