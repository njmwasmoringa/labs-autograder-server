#!/bin/bash

# Read command arguments and extract repolink, reponame and username
repolink=$1
job_auth_token=$2
apihost=$3
logfile=$4
readarray -d / -t strarr <<<"$repolink"
arraylen=`expr ${#strarr[*]} - 1`
usernameIndex=`expr ${arraylen} - 1`
reponame=${strarr[arraylen]}
username=${strarr[usernameIndex]}
readarray -d . -t repoparts <<<"$reponame"
reponame=${repoparts[0]}
echo "Welcome to lab automation"
echo "Running Tests, please wait..."

workingDir=$(pwd)
repoDir="/repos"
installPath="$workingDir$repoDir"
if [ ! -d $installPath ]; then
    mkdir $installPath
fi
cd $installPath
if [ ! -d $username ]; then
    mkdir $username
fi
cd $username

# handle when repository already exists
if [ -d $reponame ]; then
    rm -r -f $reponame
fi
echo "Clonning: $repolink"
git clone $repolink > logs.txt
#continue after checking repo existance

# Handle any cloning failure by retrying 5 times
if [ ! -d $reponame ]; then
    echo "Cloning failed"
    tries=0
   while [ $tries -lt 5 ]
    do
        git clone $repolink > logs.txt
        if [ ! -d $reponame ]; then
            tries=`expr $tries + 1`
            if [ $tries -eq 5]; then
                echo "Failed to clone the repository"
                exit
            fi
        fi
    done
fi
# Stop handling the clone failures
cat logs.txt

cd $reponame
pwd

#inpect the package.json file to determine if it's react
isReactApp=0
isReactRuby=0
if [ -f "package.json" ]; then
    while read line; do
        for word in $line; do
            if [ $word == \"react\": ]; then
                isReactApp=1
                break
            fi
        done
        if [ $isReactApp -eq 1 ]; then 
            break
        fi
    done < package.json    

    if [ ! -d "node_modules" ]; then
        echo "Installing node packages remotely..."
        npm install --production=false
    fi

    echo "Running tests..."
    if [ $isReactApp -eq 1 ]; then 
        # npm install jest-junit
        # npx react-scripts test --coverage --ci --testResultsProcessor="jest-junit" --watchAll=false
        # npm test -- --watchAll=false --no-color 2> tests.txt  
        echo "**stack**react**stack**"
        # npm test  --watchAll=false > test
        labresult=$(npx react-scripts test --watchAll=false --json)
        echo "**-----react_test_report-------**"
        tests=$($labresult | base64)
        echo $labresult
    else
        echo "**stack**javascript**stack**"  
        npm test
        echo "**-----js_test_report-------**"
        labresult=$(cat "./.results.json")
        tests=$($labresult | base64)
        echo $labresult
    fi

elif [ -f "Pipfile" ]; then
    # echo labresult
    echo "**stack**python**stack**"
    echo "Installing Python packages remotely..."
    pipenv install
    pipenv run pip install pytest-json-report 
    pipenv run pytest --json-report
    echo "**-----python_test_report-------**"
    cat .report.json
    pipenv --rm

else
    echo "**stack**ruby**stack**"
    source /usr/share/rvm/scripts/rvm
    gem install bundler rspec pry
    rm -fr Gemfile.lock
    
    if [ -f "Gemfile" ]; then
        bundle install
    fi

    if [[ $repolink == *"pry"* ]]; then
        echo "kill-pry"
    fi

    labresult=$(rspec -f j)
    tests=$(rspec -f j | jq 'del(.examples[].exception)' | base64)
    echo $labresult
fi
    
# tests=$(cat ./lab-test-results.json)

# apiresponse=$(curl -X POST \
#     -H "Authorization: Bearer $job_auth_token" \
#     -d "tests=$tests" $apihost)

# echo $apiresponse;


#cleaning up
cd $installPath
rm -fr $username

echo "--__the-__-end-___-"