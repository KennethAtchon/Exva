Hard rule that once trades are open. We do not start the selector or anything else again until the trades close with results.

Right now when u click "stop" on a session thats waiting for the trade result, it starts a new ai runtime loop and interates.


------


Build out the Autopsy tab, the autopsy tab will allow a user to select a model from their configured stuff. They will be able to have the autopsy filter things (like filter things to send to the autopsy). Be able to manage past autopsy. Have a date of where autopsys cover (like how long back to go to). Autopsy query the database for the data. Autopsy will automatically be set to go back to the date since last autopsy. Previous autopsy will have db entries with a "Lessons learned" and all that good shit in the db. When an autopsy starts up, it looks at the previous lesson learned, if we didnt fix the problems from lesson learned, the autopsy pulls the "andon cord". Which basically alerts the user that theres an extreme problem going on (not learning from fixes) that might require more input than an autopsy fix. Autopsy should be full and comprehensive, basically scolarly breakdown by a professional daytrader mentor reviewing his mentees trade and thinking process. Please fill the rest of this with other information an autopsy should have.