import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import fastifyMultipart from "@fastify/multipart";
import {SpeechClient} from '@google-cloud/speech';
import OpenAI from "openai";
import fs from 'fs'
import { createClient } from '@google/maps';
import twilio from 'twilio';
import moment from 'moment-timezone';
import mysql from 'mysql2/promise';

//Initialization
let callerNumber;
let chatHistory = "";
let currentCSTTime;
// Load environment variables from .env file
dotenv.config();
// Retrieve the OpenAI API key from environment variables.
const { OPENAI_API_KEY } = process.env;
const { GOOGLE_MAP_API_KEY } = process.env;
const { TWILIO_NUMBER } = process.env;
const {DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE} = process.env;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const managerNumber = process.env.MANAGER_NUMBER;
const messagingServiceSid = process.env.MESSAGING_SERVICE_SID;
const client = twilio(accountSid, authToken);

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

const openai = new OpenAI({apiKey: OPENAI_API_KEY});

//Initialize googleMapsClient
const googleMapsClient = createClient({
    key: GOOGLE_MAP_API_KEY
});


//Initialize sppechClient for live audio transctibing
const speechClient = new SpeechClient({keyFilename: './keyFile.json'});

// Initialize Fastify
const fastify = Fastify({
    logger: true, // This enables logging automatically
});
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
fastify.register(fastifyMultipart);

// Constants
const SYSTEM_MESSAGE = `You are a chatbot for the restaurant Tutti Da Gio. Your job is to answer questions about the Restaurant and to take orders.
You cannot process credit cards but you can text the restaurant the order after the customer has placed it.
Tutti Da Gio does not have any sides at this time.

Restaurant Related Information:
    - Indoor/Outdoor Seating
        We only accept reservations at Hendersonville for indoor seating and only for large parties of 10 or more people with a minimum order of $25 for each seat. 
        Hermitage is a to-go only restaurant with very limited outdoor seating.
    - Delivery
        We do not deliver for phone orders or orders place via AI.   
        Delivery orders can only be placed online at www dot tutti da gio dot com or www.tuttidagio.com
    - Offer/Serve
        We do offer imported Beer, Wine and Liquors at our Hendersonville location only, not for Hermitage.
        At Hermitage, patrons are welcome to take our food into Shooters Bar, next door.

Serving Time:
Serving from 4pm to 9pm on Tuesday and Wednesday and from 11am to 9pm on Thursday, Friday and Saturday.

Locations:
The restaurant has two locations:
    - Hermitage located at 5851 Old Hickory Blvd, Hermitage TN 37076 next to Shooters bar and Z-Mart, and 
    - Hendersonville located at 393 East Main Street, Hendersonville TN 37075, suite 6a.  

Food Menu Items:
1) Antipasto (Appetizers) / Insalata (Salads)
 - Arancini (Fried Rice Ball): Ragu and mozzarella cheese encased in an arborio rice ball, hand-rolled in Sicilian bread crumbs, and deep-fried to perfection. - $6
 - Caprese (Mozzarella and Tomatoes): Thick slices of tomatoes and soft, fresh mozzarella with olive oil, decorated with balsamic glaze. - $12
 - Parmigiana (Eggplant and Mozzarella): Layers of fried eggplant slices with basil, mozzarella, and sliced egg covered with homemade tomato sauce. - $14
 - Vulcano Insalata (Side / Full Serving): Tomatoes, cucumbers, capers, black olives, onion, and romaine lettuce with house-made dressing. - $6 / $10
2) Contorni (Sides)
 - Polpette Pomodoro (Meatballs and Sauce): Giovanna's house-made meatballs in marinara, decorated with parmesan cheese and herbs. - $12
 - Gamberi con Aglio e Burro (Shrimp, Garlic, Butter): Shrimp cooked with garlic, butter, and herbs. - $9
3) Panini (Italian Sandwiches)
 - Alicuti (Italian Ham and Pickled Vegetables): Fresh oven-baked bread filled with romaine lettuce, prosciutto cotto, mozzarella, tomatoes, and pickled Italian vegetables. - $17
 - Lipari (Prosciutto, Arugula, Mozzarella): Homemade bread filled with prosciutto crudo, fresh mozzarella, arugula, and tomatoes. - $18
 - Polpette (Meatballs, Mozzarella): Oven-baked bread filled with handmade meatballs, mozzarella, and parmesan cheese, baked to perfection. - $18
4) Pizze (Red Pizza - 12" Brick Oven)
 - Margherita (Cheese and Basil): Fresh mozzarella over basil and simple tomato sauce. - $15
 - Diavola (Pepperoni and Cheese): Fresh mozzarella and pepperoni over simple tomato sauce. - $17
 - Capricciosa (Artichoke & Italian Ham): Fior di latte mozzarella, artichoke hearts, mushrooms, olives, and prosciutto cotto over tomato sauce. - $18
 - Norma (Eggplant and Ricotta): Fresh mozzarella, eggplant, and baked ricotta over tomato sauce. - $16
 - Soppressata (Dry Salami): Parmesan, basil, soppressata, mozzarella, and tomato sauce. - $17
 - Calzone (Pizza Pie): Prosciutto cotto, mushrooms, mozzarella, and tomato sauce folded inside a pizza. - $17
5) Pizze Bianche (White Pizza - 12" Brick Oven)
 - Parma (Prosciutto, Arugula): Fresh mozzarella, cherry tomatoes, prosciutto crudo, arugula, and aged parmesan flakes. - $20
 - Quattro Formaggi (Four Cheese): Fresh mozzarella, asiago, gorgonzola, and parmesan. - $17
 - Salsicce e Patate (Sausage, Potato): Fresh mozzarella, sausage, and roasted potatoes garnished with rosemary. - $18
6) Bambino (Kids Menu)
 - Pasta al Burro (Pasta with Butter): Spaghetti with a little bit of butter. - $6
 - Bambino Pomodoro (Pasta, Marinara): Spaghetti in tomato sauce. - $8
 - Bambino Formaggio (Pasta, Cheese): Fusilli with a parmesan and mozzarella sauce. - $9
 - Bambino Polpette (Pasta, Meatballs): Spaghetti with meatballs and tomato sauce. - $10
7) Primi (Entrees)
 - Sicilian Lasagna (Lasagna with Eggplant): Traditional Sicilian lasagna with pasta, eggplant, prosciutto cotto, ragu, mozzarella, and bechamel with hard-boiled eggs. - $19
 - Pasta Aglio e Olio (Olive Oil and Peppers): Spaghetti with garlic, oil, parsley, cherry tomatoes, and red peppers. - $13
 - Pasta al Pomodoro (Marinara): House-made spaghetti in marinara sauce. - $12
 - Pasta alla Norma (Eggplant and Ricotta): House-made tomato sauce, eggplant, baked ricotta, and basil over caserecce. - $15
 - Pasta al Sugo con Polpette (Meatballs): House-made meatballs, tomato sauce, basil, and parmesan over spaghetti. - $17
 - Pasta alla Giovannina (Meat Ragu): House-made ragu over tagliatelle, decorated with parmesan. - $16
 - Tortellini con Prosciutto e Panna (Italian Ham): Prosciutto cotto and parmesan cream sauce over cheese tortellini. - $18
 - Gnocchi ai Pesto (Basil Pesto and Cream): Basil pesto cream with pistachio shavings over gnocchi. - $17
 - Gnocchi ai Quattro Formaggi (Four Cheese): Mozzarella, asiago, gorgonzola, and  - pecorino with fried prosciutto over gnocchi. - $17
 - Gnocchi con Gamberi e Zaffrano (Shrimp and Saffron): Saffron cream with shrimp and gnocchi. - $18
 - Pasta ai Gamberi e Zucchine (Shrimp and Zucchini): Fried zucchini and shrimp in garlic butter sauce over fusilli. - $19
 - Pasta al Salmone (Smoked Salmon and Cream): Smoked salmon, cherry tomatoes, parsley, and creamy cheese sauce over fusilli. - $19
 - Pasta alle Vongole (Clams and White Wine): White wine cream sauce over tagliatelle and clams, decorated with parsley. - $19
8) Dolce (Desserts)
 - Bianco e Nero: Vanilla cream puffs with Nutella mousse and chocolate shavings. - $6
 - Cannolo: Fried pastry shells filled with ricotta cheese, pistachio, and confectioner's sugar. - $6
 - Tiramisu: Mascarpone cream and ladyfingers soaked in coffee with chocolate sprinkles. - $6
 - Panna Cotta: Italian custard with chocolate, caramel, or strawberry sauce. - $6
9) Bevande (Beverages)
 - Bottled Water - $2
 - Pepsi Products (Bottled) - $3 (Hendersonville location only)
 - Coke Products (Bottled) - $3 (Hermitage location only)
 - Sparkling Water (Bottled) - $3
 - San Pellegrino Flavors - $3
 - Espresso - $3
If asked about allergy information, we cannot guarantee against cross contamination and we do use gluten, tree nuts, onions, and other allergen related foods.  We do not recommend people with severe allergies eat at our restaurant.
Do NOT answer questions for information you are not given here or offer food items that are not explicitly part of the menu provided to you.   Include a tax of 6.75% for all orders.

Interaction Guidelines:
1. You have to answer very carefully, kindly and quickly for the user's questions.
    No matter how important a question you have asked or what you are saying, if a user asks a question in the middle of your conversation, answer the user's question first and then ask the question again or continue what you were saying.

2. You have to get some informations from the user, so kindly ask to get information from the user.
    -Name
        Ask the user for their name.
        The name must be a valid human name. If the name is invalid or unclear, ask them to clarify.
    -Foods
        Ask for the foods they would like to order.
        When asking the foods, plz mention his/her name.
        The foods can be one or more, so keep in mind to ask the user no more foods to order.
        Even if the user adds more food, don't move on to the next question, but ask again if there are any more items they would like to order.
        Verify that the items is available on the menu. If the food is not listed, inform the user and prompt them to choose a valid menu item.
        ***Only if the user says that no more foods to order, then continue to ask next question.
    -Time
        Ask for the preferred ordering time.
        Ensure that the time is valid (e.g., formatted correctly as hours and minutes, and logically appropriate for food service hours). 
        - For exact time that is formatted as hours and minutes:
            Keep in mind that the time is logically appreciate for service time(Reference Serving Time Section).
        - In terms of Time Duration(e.g., "after X minutes from now"):
            Calculate the exact ordering time based on current time. (Ordering time = Current time + Time duration).
            Kindly confirm the user the ordering time regarding current time("Current Time is HH:MM AM/PM, so After X minutes from now is HH:MM AM/PM.")
            Keep in mind that the ordering time is logically appreciate for service time(Reference Serving Time Section).
        If time is not valid, kindly inform the user service time of the restaurant and require to ask valid time based on service time.
        Also, do not allow orders for any day but the current day and ask the user to order again for today.

3. If the user doesn't want to order, then kindly say goodbye and end conversation.

4. Confirmation
    First: When providing confirmation, you must tell the user to listen carefully to the end of the confirmation message.
    Second: When asking confirmation, repeat or mention the user's name, all ordering foods, ordering time, total price and ask the user no more things to add to the order.
        When telling about ordering foods, keep in mind to mention the cound of each food. (If the user didn't mention about the cound of food, then the count is one.)
        Speak food names clearly, slowly, correctly.
        When talking about the total price of food, mention the price and count of each food item first,  and then say the total price.
    Third: Ask the user if checked the whole confirmation and if there's anything else need to order.
    Fourth: If user added some more foods or changed something, add or update confirmation.
            When adding some more foods to the order, don't odd any food in the previous confirmation and add new foods.
            Must ask confirmation again from the "First" step.
    If user confirmed or agreed the order without listening to the end of the confirmation, don't move next and start confirmation again from the "First" step.
    Repeat confirmation until the user confirms it - must start from "First" step again.

5. After confirmation & Ending Conversation
    If the order is confirmed(user says everything is right or correct and satisfied with the order), then kindly end conversation with these sentenses. 
    You must mention 'Goodbye' when ending the call.
        Examples:
            - "Goodbye! Have a great day!"
            - "Goodbye! Enjoy your meal!"

Behavior Rules:
If asked how long will an order take then we will use time of day to provide an estimate (between 5:00 pm and 7:30 pm it will take 30-45 minutes, otherwise 10-20 minutes).
If asked if we have indoor dining, the answer is yes, we do, in Hendersonville.   Hermitage does not, and will not open back up until Feb 11th
Do not answer any questions unrelated to the restaurant, menu, or food items.
If a question is unrelated, simply state: "I can only assist with restaurant-related questions and menu items."
`
const SYSTEM_MESSAGE_FOR_JSON = `
You are a helpful assistant to be designed to generate a successful json object from the conversation between user and bot.
Plz generate a json object with user's name, phone number, ordering foods, ordering time.
Carefully analyze the conversation to see if the order has been confirmed, and if so, set isOrdered field to true, if not set false.
If the order has been confirmed, then generate user's name, ordering foods, ordering time, total price from the conversation(based on the last confirmation message or last confirmed content(name, foods, time) which the user has confirmed).
    
Field Names:
name, phone, foods, time, totalPrice isOrdered

Behavior Rules:
For generating ordering time, follow this guidline:
    - If given a user request specifying a time duration (e.g., 'I want to have it after 30 minutes from now'), calculate the exact order time. (Ordering time = Current time + Time duration) 
    - Format the output as a 24-hour time (HH:MM AM/PM).
When generating ordering foods, time and total price, must based on last bot's confirmation message that the user confirmed or agreed.

When generating foods field, reference below menu.
Keep in mind to mention the count and price of each food.
If the count of food is 1, the price is the original price of the food in the menu.
If the count of food is more than 1, the price is equal to the count multiply original price of the food in the menu.
    Example:
        1 Arancini($6), 1 Caprese($12), 2 Parmigianas($28 - because the price of one Parmigiana is $14 and the count is 2, so the price is $28)
For multiple foods the user requires, then separate each food by ",".
This below menu is foods menu so the foods must be items in the menu.
Menu
1) Antipasto (Appetizers) / Insalata (Salads)
 - Arancini (Fried Rice Ball): Ragu and mozzarella cheese encased in an arborio rice ball, hand-rolled in Sicilian bread crumbs, and deep-fried to perfection. - $6
 - Caprese (Mozzarella and Tomatoes): Thick slices of tomatoes and soft, fresh mozzarella with olive oil, decorated with balsamic glaze. - $12
 - Parmigiana (Eggplant and Mozzarella): Layers of fried eggplant slices with basil, mozzarella, and sliced egg covered with homemade tomato sauce. - $14
 - Vulcano Insalata (Side / Full Serving): Tomatoes, cucumbers, capers, black olives, onion, and romaine lettuce with house-made dressing. - $6 / $10
2) Contorni (Sides)
 - Polpette Pomodoro (Meatballs and Sauce): Giovanna's house-made meatballs in marinara, decorated with parmesan cheese and herbs. - $12
 - Gamberi con Aglio e Burro (Shrimp, Garlic, Butter): Shrimp cooked with garlic, butter, and herbs. - $9
3) Panini (Italian Sandwiches)
 - Alicuti (Italian Ham and Pickled Vegetables): Fresh oven-baked bread filled with romaine lettuce, prosciutto cotto, mozzarella, tomatoes, and pickled Italian vegetables. - $17
 - Lipari (Prosciutto, Arugula, Mozzarella): Homemade bread filled with prosciutto crudo, fresh mozzarella, arugula, and tomatoes. - $18
 - Polpette (Meatballs, Mozzarella): Oven-baked bread filled with handmade meatballs, mozzarella, and parmesan cheese, baked to perfection. - $18
4) Pizze (Red Pizza - 12" Brick Oven)
 - Margherita (Cheese and Basil): Fresh mozzarella over basil and simple tomato sauce. - $15
 - Diavola (Pepperoni and Cheese): Fresh mozzarella and pepperoni over simple tomato sauce. - $17
 - Capricciosa (Artichoke & Italian Ham): Fior di latte mozzarella, artichoke hearts, mushrooms, olives, and prosciutto cotto over tomato sauce. - $18
 - Norma (Eggplant and Ricotta): Fresh mozzarella, eggplant, and baked ricotta over tomato sauce. - $16
 - Soppressata (Dry Salami): Parmesan, basil, soppressata, mozzarella, and tomato sauce. - $17
 - Calzone (Pizza Pie): Prosciutto cotto, mushrooms, mozzarella, and tomato sauce folded inside a pizza. - $17
5) Pizze Bianche (White Pizza - 12" Brick Oven)
 - Parma (Prosciutto, Arugula): Fresh mozzarella, cherry tomatoes, prosciutto crudo, arugula, and aged parmesan flakes. - $20
 - Quattro Formaggi (Four Cheese): Fresh mozzarella, asiago, gorgonzola, and parmesan. - $17
 - Salsicce e Patate (Sausage, Potato): Fresh mozzarella, sausage, and roasted potatoes garnished with rosemary. - $18
6) Bambino (Kids Menu)
 - Pasta al Burro (Pasta with Butter): Spaghetti with a little bit of butter. - $6
 - Bambino Pomodoro (Pasta, Marinara): Spaghetti in tomato sauce. - $8
 - Bambino Formaggio (Pasta, Cheese): Fusilli with a parmesan and mozzarella sauce. - $9
 - Bambino Polpette (Pasta, Meatballs): Spaghetti with meatballs and tomato sauce. - $10
7) Primi (Entrees)
 - Sicilian Lasagna (Lasagna with Eggplant): Traditional Sicilian lasagna with pasta, eggplant, prosciutto cotto, ragu, mozzarella, and bechamel with hard-boiled eggs. - $19
 - Pasta Aglio e Olio (Olive Oil and Peppers): Spaghetti with garlic, oil, parsley, cherry tomatoes, and red peppers. - $13
 - Pasta al Pomodoro (Marinara): House-made spaghetti in marinara sauce. - $12
 - Pasta alla Norma (Eggplant and Ricotta): House-made tomato sauce, eggplant, baked ricotta, and basil over caserecce. - $15
 - Pasta al Sugo con Polpette (Meatballs): House-made meatballs, tomato sauce, basil, and parmesan over spaghetti. - $17
 - Pasta alla Giovannina (Meat Ragu): House-made ragu over tagliatelle, decorated with parmesan. - $16
 - Tortellini con Prosciutto e Panna (Italian Ham): Prosciutto cotto and parmesan cream sauce over cheese tortellini. - $18
 - Gnocchi ai Pesto (Basil Pesto and Cream): Basil pesto cream with pistachio shavings over gnocchi. - $17
 - Gnocchi ai Quattro Formaggi (Four Cheese): Mozzarella, asiago, gorgonzola, and  - pecorino with fried prosciutto over gnocchi. - $17
 - Gnocchi con Gamberi e Zaffrano (Shrimp and Saffron): Saffron cream with shrimp and gnocchi. - $18
 - Pasta ai Gamberi e Zucchine (Shrimp and Zucchini): Fried zucchini and shrimp in garlic butter sauce over fusilli. - $19
 - Pasta al Salmone (Smoked Salmon and Cream): Smoked salmon, cherry tomatoes, parsley, and creamy cheese sauce over fusilli. - $19
 - Pasta alle Vongole (Clams and White Wine): White wine cream sauce over tagliatelle and clams, decorated with parsley. - $19
8) Dolce (Desserts)
 - Bianco e Nero: Vanilla cream puffs with Nutella mousse and chocolate shavings. - $6
 - Cannolo: Fried pastry shells filled with ricotta cheese, pistachio, and confectioner's sugar. - $6
 - Tiramisu: Mascarpone cream and ladyfingers soaked in coffee with chocolate sprinkles. - $6
 - Panna Cotta: Italian custard with chocolate, caramel, or strawberry sauce. - $6
9) Bevande (Beverages)
 - Bottled Water - $2
 - Pepsi Products (Bottled) - $3 (Hendersonville location only)
 - Coke Products (Bottled) - $3 (Hermitage location only)
 - Sparkling Water (Bottled) - $3
 - San Pellegrino Flavors - $3
 - Espresso - $3
`
const VOICE = 'sage'; //Open AI Voice
const PORT = process.env.PORT || 5050; // Allow dynamic port assignment

//Transcribing audio
async function transcribeAudio(audioBuffer) {
    const request = {
        audio: {
            content: audioBuffer.toString('base64'),
        },
        config: {
            encoding: 'MULAW',  // Use 'MULAW' as you are working with Twilio audio, but consider 'LINEAR16' if possible.
            sampleRateHertz: 8000,  // Keep this at 8000 Hz, matching Twilio's audio sample rate.
            languageCode: 'en-US',
            interimResults: true,  // Enable interim results to receive partial transcriptions in real-time.
            enableWordTimeOffsets: true,  // Enable word-level timestamps to analyze which words are being missed.
            enableAutomaticPunctuation: false,  // Optional: Enable punctuation
            maxAlternatives: 1,  // Only get one transcription alternative to avoid inconsistencies.
            speechContexts: [{
                phrases: [
                    'Caprese', 'Arancini', 'Antipasto', 'Parmigiana', 'Vulcano Insalata',
                    'Polpette Pomodoro', 'Gamberi con Aglio e Burro', 'Alicuti', 'Lipari', 
                    'Panini', 'Pizze', 'Margherita', 'Diavola', 'Capricciosa', 'Norma', 
                    'Soppressata', 'Calzone', 'Pizze Bianche', 'Parma', 'Quattro Formaggi', 'Salsicce e Patate', 
                    'Bambino', 'Pasta al Burro', 'Bambino Pomodoro', 'Bambino Formaggio', 'Bambino Polpette', 'Primi', 
                    'Sicilian Lasagna', 'Pasta Aglio e Olio', 'Pasta al Pomodoro', 'Pasta alla Norma', 'Pasta al Sugo con Polpette', 'Gnocchi con Gamberi e Zaffrano', 
                    'Pasta alla Giovannina', 'Tortellini con Prosciutto e Panna', 'Gnocchi ai Pesto', 'Gnocchi ai Quattro Formaggi', 'Pasta ai Gamberi e Zucchine', 'Pasta al Salmone', 
                    'Pasta alle Vongole', 'Dolce', 'Bianco e Nero', 'Cannolo', 'Tiramisu', 'Panna Cotta', 
                    'Bevande', 'Bottled Water', 'Pepsi Products', 'Coke Products', 'Sparkling Water', 'San Pellegrino Flavors', 
                    'Espresso'
                ],  // Custom phrases to boost accuracy for specific food names.
                boost: 50.0  // Optionally boost the probability of these custom phrases.
            }],
            model: 'phone_call',  // Use the 'phone_call' model, which is optimized for audio from telephony.
            detailedResults: true,  // Enable detailed results for better insight into transcription.
        }
    };

    try {
        const [response] = await speechClient.recognize(request);
        let transcription = "";
        response.results.forEach((result) => {
            result.alternatives.forEach((alternative) => {
                // Log each alternative result to see possible alternatives
                transcription += alternative.transcript + '\n';
            });
        });
        return transcription;
    } catch (err) {
        console.error('Error transcribing audio:', err);
        throw err;
    }      
}

// Sending SMS to the user via Twilio
const sendingSMS = async (content, contentToManager) => {
    //Sending SMS to sender
    const message = await client.messages.create({
        body: content,
        messagingServiceSid: messagingServiceSid,
        to: callerNumber,
      });
    //Sending SMS to manager
    const messageToManager = await client.messages.create({
        body: contentToManager,
        messagingServiceSid: messagingServiceSid,
        to: managerNumber,
    });

    console.log(message.body + "was sent to the user.");
    console.log(messageToManager.body + "was sent to the manager.");
}

//Handle chat history and save it to a json file.
const handleHistory = async () => {
    currentCSTTime = moment().tz('America/Chicago').format('HH:mm:ss');
    // Transcribe the recording
    console.log("Chat history::::::" + chatHistory);
    const completion = await openai.chat.completions.create({
        model: "gpt-4-1106-preview",
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: SYSTEM_MESSAGE_FOR_JSON + "Current Time: " + currentCSTTime },
            {
                role: "user",
                content: chatHistory + "Phone Number: " + callerNumber
            },
        ],
    });
    return completion.choices[0].message.content; // Extract the JSON content
}

//Routing
// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Route for Twilio to handle incoming calls
fastify.all('/incoming-call', async (request, reply) => {
    currentCSTTime = moment().tz('America/Chicago').format('hh:mm A');
    console.log("user connected.");
    callerNumber = request.query.From; // Extracting the caller's number
    console.log(`Incoming call from: ${callerNumber}`);
    chatHistory = ""
    
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
            <Pause length="1"/>
            <Connect>
                <Stream url="wss://${request.headers.host}/media-stream" />
            </Connect>
        </Response>`;
    reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {   
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {

        // Connection-specific state
        let streamSid = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;

        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        // Open event for OpenAI WebSocket
        openAiWs.on('open', () => {
            setTimeout(initializeSession, 100);
        });

        // Control initial session with OpenAI
        const initializeSession = () => {
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    turn_detection: { type: 'server_vad' },
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    voice: VOICE,
                    instructions: SYSTEM_MESSAGE + "Current Time: " + currentCSTTime + ". Please keep your responses concise and limit them to 4096 tokens.",
                    modalities: ["text", "audio"],
                    temperature: 1
                }
            };

            openAiWs.send(JSON.stringify(sessionUpdate));

            // Uncomment the following line to have AI speak first:
            sendInitialConversationItem();
        };

        // Send initial conversation item if AI talks first
        const sendInitialConversationItem = () => {
            const initialConversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Greet the user with "Hello there! Thank you for calling Tutti Da Gio, I am your friendly virtual assistant here to take your order or to answer your questions.   What can I do for you today?"'
                        }
                    ]
                }
            };

            // if (SHOW_TIMING_MATH) console.log('Sending initial conversation item:', JSON.stringify(initialConversationItem));
            openAiWs.send(JSON.stringify(initialConversationItem));
            openAiWs.send(JSON.stringify({ type: 'response.create' }));
        };

        // Handle interruption when the caller's speech starts
        const handleSpeechStartedEvent = () => {
            if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
                const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;

                if (lastAssistantItem) {
                    const truncateEvent = {
                        type: 'conversation.item.truncate',
                        item_id: lastAssistantItem,
                        content_index: 0,
                        audio_end_ms: elapsedTime
                    };
                    openAiWs.send(JSON.stringify(truncateEvent));
                }

                connection.send(JSON.stringify({
                    event: 'clear',
                    streamSid: streamSid
                }));

                // Reset
                markQueue = [];
                lastAssistantItem = null;
                responseStartTimestampTwilio = null;
            }
        };

        // Send mark messages to Media Streams so we know if and when AI response playback is finished
        const sendMark = (connection, streamSid) => {
            if (streamSid) {
                const markEvent = {
                    event: 'mark',
                    streamSid: streamSid,
                    mark: { name: 'responsePart' }
                };
                connection.send(JSON.stringify(markEvent));
                markQueue.push('responsePart');
            }
        };

        let userBuffer = Buffer.alloc(0);
        let botBuffer = Buffer.alloc(0);
        // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);

                // Extract food items only
                // if (response.foods) {
                //     console.log("&&&&&&&&&&&&&&&Food&&&&&&&&&&&&&&&& Items Detected:", response.foods);
                // }

                if (response.type === 'response.audio.done') {
                    if (botBuffer.length != 0){
                        //Clone botBuffer for async
                        const botBufferToProcess = Buffer.from(botBuffer);
                        botBuffer = Buffer.alloc(0);
                        // Call transcribeAudio asynchronously without blocking execution
                        (async () => {
                            try {
                                const transcription = await transcribeAudio(botBufferToProcess);
                                console.log("******OpenAI response finished: *******" + transcription)
                                chatHistory += 'bot:' + transcription + '\n';
                                //Disconnect call when OpenAI says goodbye
                                if (transcription.includes("goodbye")) {
                                    console.log('Goodbye signal detected. Ending call...');
                                    setTimeout(() => {
                                        console.log('Closing connection after 5 seconds...');
                                        connection.close(1000, 'Normal closure'); // Close with status code 1000
                                    }, 12000);
                                }
                            } catch (error) {
                                console.error('Error during transcription:', error);
                            }
                        })();
                    }
                    
                    if (userBuffer.length != 0)
                    {
                        //Clone userBuffer for async
                        const userBufferToProcess = Buffer.from(userBuffer);
                        userBuffer = Buffer.alloc(0);
                        // Call transcribeAudio asynchronously without blocking execution
                        (async () => {
                            try {
                                const transcription = await transcribeAudio(userBufferToProcess);
                                chatHistory += 'user:' + transcription + '\n';
                            } catch (error) {
                                console.error('Error during transcription:', error);
                            }
                        })();
                    }
                }

                if (response.type === 'response.audio.delta' && response.delta) {

                    const buffer = Buffer.from(response.delta, 'base64');
                    botBuffer = Buffer.concat([botBuffer, buffer]);

                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
                    };

                    connection.send(JSON.stringify(audioDelta));

                    if (!responseStartTimestampTwilio) {
                        responseStartTimestampTwilio = latestMediaTimestamp;
                    }

                    if (response.item_id) {
                        lastAssistantItem = response.item_id;
                    }
                    
                    // console.log("OpenAI Stream is Coming!!!!!!!!!!!")
                    sendMark(connection, streamSid);
                }

                if (response.type === 'input_audio_buffer.speech_started') {
                    // console.log('OpenAI detected user audio request ********'); // Specific log for speech detection
                    handleSpeechStartedEvent();
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error, 'Raw message:', data);
            }
        });

        // Handle incoming messages from Twilio
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        latestMediaTimestamp = data.media.timestamp;

                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            const buffer = Buffer.from(data.media.payload, 'base64');
                            userBuffer = Buffer.concat([userBuffer, buffer]);
                            openAiWs.send(JSON.stringify(audioAppend));
                            // console.log("Sending Audio to OpenAI-----------");
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        // console.log('Incoming stream has started');

                        responseStartTimestampTwilio = null; 
                        latestMediaTimestamp = 0;
                        break;
                    case 'mark':
                        if (markQueue.length > 0) {
                            markQueue.shift();
                        }
                        break;
                    default:
                        console.log('Received non-media event:');
                        break;
                }
            } catch (error) {
                console.error('Error parsing message:', error, 'Message:', message);
            }
            
        });
        // Handle connection close
        connection.on('close', async () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            
            //Handling History
            try {
                const jsonResponse = await handleHistory();
                const jsonData = JSON.parse(jsonResponse); // Parse the string to JSON
                
                if (jsonData.isOrdered == false){
                    console.log("Order is not confirmed.");
                    return;
                };
                //Send SMS to the user
                console.log('Sending SMS...');
                await sendingSMS(`Dear ${jsonData.name},\nWe are pleased to inform you that your order of ${jsonData.foods} has been successfully processed.\nThe total price of your order is ${jsonData.totalPrice} and your food will be prepared at ${jsonData.time} as requested.\nWe hope you enjoy your meal and have a wonderful experience. Should you have any questions or\nneed further assistance, please don’t hesitate to reach out.\nThank you for choosing us. We look forward to serving you again in the future.\nWarm Regards.`,
                        `${jsonData.name}(Contact Number: ${callerNumber}) ordered ${jsonData.foods}. The total price of this order is ${jsonData.totalPrice} and this will must be prepared until ${jsonData.time}.`);
                addOrder(jsonData.name, callerNumber, jsonData.foods, jsonData.time, jsonData.totalPrice)
                
                //Save geocoded address
                fs.writeFileSync('output.json', JSON.stringify(jsonData, null, 2)); // Write to file with address
            } catch (error) {
                console.error('Error:', error);
            }
            // console.log('user disconnected.\n' + chatHistory);
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
        });

        openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
        });
    });
});

//Initializing DB
const dbConfig = {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_DATABASE,
};
  
//Connecting DB and Add Order
async function addOrder(name, phone, foods, time, price) {
    try {
      const connection = await mysql.createConnection(dbConfig);
      console.log('Connected to MySQL');
  
      const query = `INSERT INTO orders (name, phone, foods, price, time) VALUES (?, ?, ?, ?, ?)`;
      const values = [name, phone, foods, price, time];
  
      const [result] = await connection.execute(query, values);
      console.log(`Order added! Inserted ID: ${result.insertId}`);
  
      //Close DB
      await connection.end();
    } catch (error) {
      console.error('Database Error:', error);
    }
  }
  

fastify.listen({ port: PORT, host: '0.0.0.0'}, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});