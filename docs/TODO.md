Project Exva is a project for an self trading AI model.


- We need a UI update where theres multiple accounts, like for example, with AI, we can choose to switch the models. We need to add this feature
- Allow users to configure their own model system settings while we have default, like they can change system prompt for decisioner, researchers, reviewer model, put this interface as part of strategy tab, 
- I dont like the current way session is stored and working, I want a whole tab for managing session. Create a research doc for this. What I expect is the following: A user can have multiple sessions running, each with their own AI models running on it, for the actual tasks at hand, they should be focused on one task, I think before we do this we need clear boundary for tasks

What the system is:
- 4 agents working together to figure out whether to buy a stock or not, we might need a 5th agent for actually picking the stock that we want to consider, like one that looks through the internet for debated stocks or stocks with easy gain potential - this AI will probably be the most valuable and single point of failure because if it picks a bad stock we cant win
- The "stock" object shouldn't really just be a stock, we need to rename it to instrument or something ~ this is because the AI will also trade crypto, futures, etc. Other instruments. We need to create a system that does a good job at differentiating them, allowing the user to pick which instrument they want to trade or let the AI pick, and connect with the appropriate broker for said instruments, again this will be a multiple broker deal
- We need to make sure things can run at parallel and that user can add multiple brokers, basically we need to give the user more freedom, compared to the current state of things
- There could be other things I'm not thinking about, those are just the first things that we need to get rid, and code organization, right now the code is in an infant state, the services only have one top level ts file. I think we will need to add subfolders for each service and find ways of proper code organization strategies and such and such before we begin serious implementation so that things don't get messy. 
- for the ai sdk, this needs to be singificantly fleshed out, add a markdown for the system prompt and maybe we can incorporate skills (if the ai sdk allows us), and also I think we need multiple ai providers like opencode, claude, openai, and give the option to switch between them, also the ai needs to be able to search the internet, we need to refine these features.

Please highlight anything I'm missing

