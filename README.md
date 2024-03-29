# Log Who Hung Up the Conversation - to Flex Insights

Flex Insights uses the `hang_up_by` conversations attribute to report on who hung up the call. It's actually not set out-of-the-box by Flex - because it's not simple to immediately and accurately determine. Even the Voice Insights product can take up to 60s to determine this.

This plugin aims to make some assumptions, in order to set the field as accurately as is possible for known scenarios, and default it to something in other cases. Those assumptions are:

* If call is hung up by the agent by clicking Hangup, then we set `hang_up_by='Agent'`
* If call is disconnected because the agent refreshed page or became unreachable, then we set `hang_up_by='Agent-System-Issue'`
* If call is transferred by the agent by completing a Transfer, then we clear the `hang_up_by` attribute for this reservation, and let the next reservation take over
* In all other cases, we assume customer hung up, so we set `hang_up_by='Customer'`

## Beware of Race Conditions with Task Attributes...

In this plugin, we don’t actually persist the `hang_up_by` attribute to the task until just before the reservation completes.  This is because:

* Insights only pulls in a snapshot of the task attributes upon completion of the reservation - so changing the value before this point isn't needed, and...
* Since Flex uses the same task for all reservations relating to a call - it can be tricky to protect against stale data overwrites due to multiple reservations writing to the same task. e.g. potentially a transferee agent’s Flex UI could update the task attributes while the transferring agent is still wrapping up their own reservation - for the same task! 
  * So best to just hold onto any state internally in the Flex app (and/or in backend orchestration service - if it’s critical business state needed outside of the Flex app), then persist any task attribute changes when you complete your reservation. So a single write - purely for ensuring the Flex Insights snapshot is accurate for the completed reservation/segment
  * UPDATE 9/22: This will also mitigate against stricter Taskrouter rate limits on Task updates of 20 CPS. See [Taskrouter API Rate Limits](https://www.twilio.com/docs/taskrouter/limits#api-rate-limits)

## Page Refreshes
In the case of a page refresh, or the agent's Flex UI being unreachable for any reason - and subsequently requiring the agent to reload the UI - we want to track this for the purposes of reporting. As such, this plugin will detect such scenarios through use of persisted call state in local browser storage. If it's detected that a call was disconnected when the Flex UI wasn't *listening* (or as a result of a network issue on the agent side), then the plugin will set `hang_up_by='Agent-System-Issue'` - to allow for coaching opportunities.  


## Further work, TODOs & Considerations

In future, we would like to include additional guidance around:

* IVR calls
  * Calls that don't ever become tasks won't be reported on in Flex Insights out-of-the-box, and certainly won't benefit from this plugin. We have a great blog post on using Taskrouter to log IVR call segments to Flex Insights - if you do need to report on those calls. 
    * See https://www.twilio.com/blog/ivr-with-flex-insights. 
  * Depending on your reporting needs (e.g. if just using it for agent coaching), you may not need to set `hang_up_by` on these calls.
  * If you do need to report on how IVR calls terminated, you will need to use the approach above - to get those call segments logged in Flex Insights.
* Calls that are hung up post-IVR, but before ever reaching an agent
  * Again, these won't hit our plugin code, so you need to decide if you care to report on who hung up such calls. Since these calls are Tasks, they will hit Flex Insights and be reportable - as "Abandoned" calls. 
  * It could be argued that - since Flex Insights offers reporting on these Abandoned calls already, it may be preferable to simply exclude such calls when reporting on `hang_up_by`. This would make sense if using this attribute specifically for coaching of agents.
* Transferred calls
  * If we transfer a call - we clear out `hang_up_by` - so that only a single segment in the conversation ever has this attribute set in Insights
  * But what if we transfer it externally, and so there is no downstream segment/reservation created?? 
    * This opens up a whole discussion around detecting and reporting on warm & cold transfers - so TBD on this
* Outbound calls
  * Haven't fully considered this one.
* Reservation-level Taskrouter attributes...
  * A lot of this plugin logic is necessitated by the fact that multiple reservations for the same task share the same task attributes. As such, we have to be very careful on when we save those task attributes - for fear of inadvertently impacting another concurrent reservation for the same task/call. 
  * It would be ideal if reservations could have their own ring-fenced attribute data model, and if Flex Insights could pull from this when grabbing the reporting snapshot on `reservation.completed`
  * Moreso, we would be able to safely write to those reservation-level attributes immediately via the SDK - which would further mitigate risk of losing important reporting data due to us having to wait until task is completed before we persist.

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


