import { Copy } from "./Copy";

export const Greeting = {
    get Morning() { return Copy.GreetingMorning; },
    get Midday() { return Copy.GreetingMidday; },
    get Evening() { return Copy.GreetingEvening; },
    get Night() { return Copy.GreetingNight; }
};
