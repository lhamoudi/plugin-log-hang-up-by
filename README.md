# Log Who Hung Up the Conversation - to Flex Insights

Flex Insights uses the `hang_up_by` conversations attribute to report on who hung up the call. It's actually not set out-of-the-box by Flex - because it's not simple to immediately and accurately determine. Even the Voice Insights product can take up to 60s to determine this.

This plugin aims to make some assumptions, in order to set the field as accurately as is possible for known scenarios, and default it to something in other cases. Those assumptions are:

* If call is hung up by the agent by clicking Hangup, then we set `hang_up_by=Agent`
* If call is transferred by the agent by completing a Transfer, then we clear the `hang_up_by` attribute for this reservation, and let the next reservation take over
* In all other cases, we assume customer hung up, so we set `hang_up_by=Customer`

## Beware of Race Conditions with Task Attributes...

In this plugin, we don’t actually persist the `hang_up_by` attribute to the task until just before the reservation completes.  This is because:

* Insights only pulls in a snapshot of the task attributes upon completion of the reservation - so changing the value before this point isn't needed, and...
* Since Flex uses the same task for all reservations relating to a call - it can be tricky to protect against stale data overwrites due to multiple reservations writing to the same task. e.g. potentially a transferee agent’s Flex UI could update the task attributes while the transferring agent is still wrapping up their own reservation - for the same task! 
  * So best to just hold onto any state internally in the Flex app (and/or in backend orchestration service - if it’s critical business state needed outside of the Flex app), then persist any task attribute changes when you complete your reservation. So a single write - purely for ensuring the Flex Insights snapshot is accurate for the completed reservation/segment

## About Twilio Flex Plugins

Twilio Flex Plugins allow you to customize the appearance and behavior of [Twilio Flex](https://www.twilio.com/flex). If you want to learn more about the capabilities and how to use the API, check out our [Flex documentation](https://www.twilio.com/docs/flex).

## Setup

Make sure you have [Node.js](https://nodejs.org) as well as [`npm`](https://npmjs.com). We support Node >= 10.12 (and recommend the _even_ versions of Node). Afterwards, install the dependencies by running `npm install`:

```bash
cd 

# If you use npm
npm install
```

Next, please install the [Twilio CLI](https://www.twilio.com/docs/twilio-cli/quickstart) by running:

```bash
brew tap twilio/brew && brew install twilio
```

Finally, install the [Flex Plugin extension](https://github.com/twilio-labs/plugin-flex) for the Twilio CLI:

```bash
twilio plugins:install @twilio-labs/plugin-flex
```

## Development

In order to develop locally, you can use the Webpack Dev Server by running (from the root plugin directory):

```bash
twilio flex:plugins:start
```

This will automatically start up the Webpack Dev Server and open the browser for you. Your app will run on `http://localhost:3000`. If you want to change that you can do this by setting the `PORT` environment variable:

When you make changes to your code, the browser window will be automatically refreshed.

## Deploy

When you are ready to deploy your plugin, in your terminal run:
```
Run: 
twilio flex:plugins:deploy --major --changelog "Notes for this version" --description "Functionality of the plugin"
```
For more details on deploying your plugin, refer to the [deploying your plugin guide](https://www.twilio.com/docs/flex/plugins#deploying-your-plugin).


